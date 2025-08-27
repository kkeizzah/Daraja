import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configuration
const config = {
  sandbox: process.env.SANDBOX === 'true',
  consumerKey: process.env.CONSUMER_KEY,
  consumerSecret: process.env.CONSUMER_SECRET,
  shortcode: process.env.SHORTCODE || '6434270',
  passkey: process.env.PASSKEY,
  callbackURL: process.env.CALLBACK_URL || `http://localhost:${PORT}/callback`,
  accountRef: process.env.ACCOUNT_REF || 'HELB Disbursement'
};

// Validate required configuration
if (!config.consumerKey || !config.consumerSecret || !config.passkey) {
  console.error('Missing required environment variables: CONSUMER_KEY, CONSUMER_SECRET, PASSKEY');
  process.exit(1);
}

// Helper function to write logs
function writeLog(type, data) {
  const timestamp = new Date().toISOString();
  const logFile = path.join(logsDir, `${type}_log.json`);
  const logEntry = { timestamp, ...data };
  
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

// Get Daraja API endpoints based on environment
function getEndpoints() {
  if (config.sandbox) {
    return {
      auth: 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      stkPush: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
    };
  }
  return {
    auth: 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    stkPush: 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
  };
}

// Get access token from Daraja API
async function getAccessToken() {
  const endpoints = getEndpoints();
  const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
  
  try {
    const response = await axios.get(endpoints.auth, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.data.access_token) {
      throw new Error('Failed to obtain access token');
    }
    
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error.message);
    throw new Error(`Authentication failed: ${error.response?.data?.errorMessage || error.message}`);
  }
}

// Initiate STK Push
async function initiateSTKPush(accessToken, phone, amount) {
  const endpoints = getEndpoints();
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const password = Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');
  
  const payload = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerBuyGoodsOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: config.shortcode,
    PhoneNumber: phone,
    CallBackURL: config.callbackURL,
    AccountReference: config.accountRef,
    TransactionDesc: 'HELB Disbursement'
  };
  
  try {
    const response = await axios.post(endpoints.stkPush, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error initiating STK push:', error.message);
    throw new Error(`STK push failed: ${error.response?.data?.errorMessage || error.message}`);
  }
}

// Routes

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// STK Push endpoint
app.post('/stk_push', async (req, res) => {
  try {
    const { phone, amount } = req.body;
    
    // Validate input
    if (!phone || !amount) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Missing phone or amount' 
      });
    }
    
    // Validate phone format
    if (!/^2547\d{8}$/.test(phone)) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid phone format. Use format: 2547XXXXXXXX' 
      });
    }
    
    // Validate amount
    const amountNum = parseInt(amount);
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > 150000) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid amount. Must be between 1 and 150,000' 
      });
    }
    
    // Log the request
    writeLog('request', { phone, amount: amountNum });
    
    // Get access token and initiate STK push
    const accessToken = await getAccessToken();
    const stkResponse = await initiateSTKPush(accessToken, phone, amountNum);
    
    // Check if STK push was successful
    if (stkResponse.ResponseCode === '0') {
      res.json({
        ok: true,
        checkout_id: stkResponse.CheckoutRequestID,
        response_code: stkResponse.ResponseCode,
        message: 'STK push initiated successfully'
      });
    } else {
      res.status(500).json({
        ok: false,
        error: stkResponse.ResponseDescription || 'STK push failed'
      });
    }
    
  } catch (error) {
    console.error('STK push error:', error.message);
    res.status(500).json({ 
      ok: false, 
      error: error.message 
    });
  }
});

// Callback endpoint
app.post('/callback', (req, res) => {
  try {
    const callbackData = req.body;
    
    // Log the callback
    writeLog('callback', {
      ip: req.ip,
      data: callbackData
    });
    
    console.log('Received callback:', JSON.stringify(callbackData, null, 2));
    
    // Respond with success
    res.json({
      ResultCode: 0,
      ResultDesc: 'Callback received successfully'
    });
    
  } catch (error) {
    console.error('Callback error:', error);
    res.status(500).json({
      ResultCode: 1,
      ResultDesc: 'Error processing callback'
    });
  }
});

// Mock endpoint for testing
app.post('/mock_stk', (req, res) => {
  const { phone, amount } = req.body;
  
  // Log the mock request
  writeLog('mock', { phone, amount });
  
  // Simulate delay
  setTimeout(() => {
    res.json({
      ok: true,
      checkout_id: `MOCK_${Date.now()}`,
      response_code: '0',
      message: 'Mock STK push initiated successfully'
    });
  }, 1000);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${config.sandbox ? 'Sandbox' : 'Production'}`);
  console.log(`STK Push endpoint: http://localhost:${PORT}/stk_push`);
  console.log(`Callback endpoint: http://localhost:${PORT}/callback`);
  console.log(`Mock endpoint: http://localhost:${PORT}/mock_stk`);
});
