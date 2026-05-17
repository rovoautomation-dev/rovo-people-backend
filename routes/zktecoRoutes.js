import express from 'express';
import {
    handshake,
    handleAttendanceData,
    handleGetRequest,
    handleDeviceCommand,
    handlePing
} from '../controllers/zktecoController.js';

const router = express.Router();

// All ZKTeco ADMS routes are PUBLIC (no auth) — devices communicate directly
// These routes must match the ADMS protocol paths exactly

// ADMS Debug Logger — logs EVERY incoming device request with full detail
router.use((req, res, next) => {
    const sn = req.query?.SN || req.query?.sn || 'N/A';
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip;

    console.log(`[ZKTeco ADMS] Incoming: ${req.method} ${req.originalUrl}`);
    console.log(`[ZKTeco ADMS] IP: ${ip} | SN: ${sn} | UA: ${req.headers['user-agent']}`);
    if (req.body && typeof req.body === 'string' && req.body.length > 0) {
        console.log(`[ZKTeco ADMS] Body Length: ${req.body.length} | Start: ${req.body.substring(0, 50)}...`);
    }
    next();
});

// ── ADMS Endpoints ──────────────────────────────────────────

// Device Handshake (Usually GET, sometimes POST payload)
router.route('/cdata')
    .get(handshake)
    .post(handleAttendanceData); // This also handles POST handshakes/data combinations

// Test endpoint — use this to verify if /iclock is reachable
router.get('/test', (req, res) => {
    res.status(200).type('text/plain').send('ADMS Server is reachable\nQuery: ' + JSON.stringify(req.query));
});

// Device polling — device checks for pending commands
router.get('/getrequest', handleGetRequest);

// Command results — device reports command execution results
router.post('/devicecmd', handleDeviceCommand);

// Ping — keep-alive from device
router.get('/ping', handlePing);

// Catch-all for any other ZKTeco requests (for debugging)
router.all('*', (req, res) => {
    console.log(`[ZKTeco] UNKNOWN ROUTE - Method: ${req.method} | URL: ${req.originalUrl || req.url}`);
    console.log(`[ZKTeco] Headers: ${JSON.stringify(req.headers)}`);
    console.log(`[ZKTeco] Body: ${typeof req.body === 'string' ? req.body.substring(0, 500) : JSON.stringify(req.body)}`);
    res.status(200).send('OK');
});

export default router;
