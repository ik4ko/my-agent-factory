const fetch = require('node-fetch'); // Use node-fetch for Node.js environments

const API_URL = process.env.NODE_ENV === 'production'
  ? 'YOUR_PRODUCTION_URL_HERE/api/marx/verify' // Replace with your actual production URL
  : 'http://localhost:3000/api/marx/verify';

// IMPORTANT: Replace with a valid memberId from your database for testing.
// IMPORTANT: Replace with a valid API key from your 'brokers' table for testing.
const MOCK_PAYLOAD = {
  "memberId": "ENTER_YOUR_TEST_MEMBER_UUID_HERE", // e.g., "a1b2c3d4-e5f6-7890-1234-567890abcdef"
  "hasActiveMA": false,
  "onlyPartD": true,
  "planCode": "S5884-131",
  "endDate": "2025-12-31"
};

const API_KEY = "YOUR_API_KEY_HERE"; // e.g., "sk_live_..." or "sk_test_..."

async function sendMockVerificationRequest() {
  console.log(`Sending mock verification request to: ${API_URL}`);
  console.log('Payload:', JSON.stringify(MOCK_PAYLOAD, null, 2));

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(MOCK_PAYLOAD),
    });

    const data = await response.json();
    console.log('Response Status:', response.status);
    console.log('Response Body:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error sending mock request:', error);
  }
}

sendMockVerificationRequest();