import BiometricDevice from '../models/BiometricDevice.js';
import BiometricEmployee from '../models/BiometricEmployee.js';
import BiometricDeviceAttendance from '../models/BiometricDeviceAttendance.js';
import BiometricCommand from '../models/BiometricCommand.js';
import { Attendance } from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import { getWorkingHoursConfig, parseTimeToDate } from '../utils/workingHoursHelper.js';

/**
 * ZKTeco ADMS Protocol Controller
 */

// Helper: Hyper-flexible Serial Number (SN) extraction
const getSN = (req) => {
    // 1. Try common query parameters (case-insensitive)
    let sn = req.query?.SN || req.query?.sn || req.query?.Serial || '';

    // 2. Try headers (common in proxies or newer firmware)
    if (!sn) {
        sn = req.headers['x-device-sn'] ||
            req.headers['device-sn'] ||
            req.headers['sn'] || '';
    }

    // 3. Try raw body (regex fallback for older devices)
    if (!sn && typeof req.body === 'string') {
        const match = req.body.match(/SN=([A-Z0-9]+)/i);
        if (match) sn = match[1];
    }

    // 4. Try object body
    if (!sn && typeof req.body === 'object') {
        sn = req.body?.SN || req.body?.sn || '';
    }

    return (sn || '').toString().toUpperCase().trim();
};

/**
 * Hyper-Advanced ADMS Handshake
 */
export const handshake = async (req, res) => {
    try {
        const sn = getSN(req);
        const deviceIp = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip;

        console.log(`[ZKTeco ADMS] Handshake Request | SN="${sn}" | IP=${deviceIp}`);

        if (!sn) {
            console.warn('[ZKTeco ADMS] Handshake REJECTED: Missing SN');
            return res.status(200).type('text/plain').send('ERROR: Missing SN\r\n');
        }

        // AUTO-DISCOVERY: Ensure device exists in DB immediately
        let device = await BiometricDevice.findOne({ serialNumber: sn });
        if (!device) {
            console.log(`[ZKTeco ADMS] Auto-registering new device: ${sn}`);
            device = await BiometricDevice.create({
                deviceName: `Auto_${sn.slice(-4)}`,
                serialNumber: sn,
                status: 'online',
                deviceIp: deviceIp
            });
        }

        // Always Update status
        device.status = 'online';
        device.deviceIp = deviceIp;
        device.lastOnline = new Date();
        await device.save();

        // Standard ADMS Options — mimicking ZKTime.Net and Laravel integration
        const timestamp = Math.floor(Date.now() / 1000);

        // This response string is modeled after ZKTime.Net and other standard ADMS servers
        const options = [
            `GET OPTION FROM: ${sn}`,
            `RegistryCode=OK`,
            `Stamp=9999`,
            `OpStamp=${timestamp}`,
            `OpLogStamp=${device.opLogStamp || 0}`,
            `AttLogStamp=${device.attLogStamp || 0}`,
            `ErrorDelay=60`,
            `Delay=30`,
            `ResLogDay=18250`,
            `ResLogDelCount=10000`,
            `ResLogCount=50000`,
            `TransTimes=00:00;23:59`,
            `TransInterval=1`,
            `TransFlag=1111000000`,
            `TimeZone=5.5`,
            `Realtime=1`,
            `Encrypt=0`,
            `ServerVer=2.4.1`,
            `PushVer=2.4.1`,
            `SupportCommand=1`,
            `SupportFP=1`,
            `SupportFace=1`,
            `SupportUserPhoto=1`
        ];

        const responseStr = options.join('\r\n') + '\r\n';

        console.log(`[ZKTeco ADMS] Handshake SUCCESS for ${sn}`);

        return res.status(200)
            .setHeader('Content-Type', 'text/plain')
            .setHeader('Connection', 'close')
            .setHeader('Pragma', 'no-cache')
            .setHeader('Cache-Control', 'no-cache')
            .send(responseStr);

    } catch (error) {
        console.error('[ZKTeco ADMS] Handshake Critical Error:', error);
        return res.status(200).type('text/plain').send('OK\r\n');
    }
};

/**
 * Hyper-Resilient Data Reception
 */
export const handleAttendanceData = async (req, res) => {
    try {
        const sn = getSN(req);
        const deviceIp = req.headers['x-forwarded-for'] || req.ip || '';

        if (!sn) return res.status(200).type('text/plain').send('OK\r\n');

        let device = await BiometricDevice.findOne({ serialNumber: sn });
        if (!device) {
            console.log(`[ZKTeco ADMS] Data from unknown device ${sn}. Auto-registering.`);
            device = await BiometricDevice.create({
                deviceName: `Auto_${sn.slice(-4)}`,
                serialNumber: sn,
                status: 'online',
                deviceIp: deviceIp
            });
        } else {
            device.status = 'online';
            device.deviceIp = deviceIp;
            device.lastOnline = new Date();
            await device.save();
        }

        const rawContent = typeof req.body === 'string' ? req.body : '';

        // Split raw input by newlines using regex to handle all OS types
        const rows = rawContent.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0);

        console.log(`[ZKTeco ADMS] Received ${rows.length} rows from ${sn}`);

        // If this contains fingerprint data (FP PIN=)
        if (rawContent.includes('FP PIN=') || rawContent.includes('USER PIN=')) {
            await recordFingerprint(rows, device);
        } else {
            await markAttendanceToDeviceAndApplication(rows, device, req);
        }

        return res.status(200).setHeader('Content-Type', 'text/plain').send('OK\r\n');
    } catch (error) {
        console.error('[ZKTeco ADMS] Data Reception Error:', error);
        return res.status(200).type('text/plain').send('OK\r\n');
    }
};

/**
 * Handle Device Polling — GET /iclock/getrequest?SN=xxx
 * Devices poll this endpoint to receive pending commands.
 */
export const handleGetRequest = async (req, res) => {
    try {
        const sn = getSN(req);
        const deviceIp = req.headers['x-forwarded-for'] || req.ip || '';
        const userAgent = req.headers['user-agent'] || 'N/A';

        if (!sn) {
            return res.status(200).type('text/plain').send('OK');
        }

        console.log(`[ZKTeco] Polling (getrequest): SN="${sn}" | IP=${deviceIp} | UA=${userAgent}`);

        const device = await BiometricDevice.findOne({ serialNumber: sn });
        if (device) {
            device.status = 'online';
            device.deviceIp = deviceIp;
            device.lastOnline = new Date();
            await device.save();
        } else {
            console.warn(`[ZKTeco] Polling from unregistered device: ${sn}`);
        }

        // Look for pending command for this device
        const command = await BiometricCommand.findOne({
            deviceSerialNumber: sn,
            status: 'pending'
        }).sort({ createdAt: 1 });

        if (command) {
            console.log(`[ZKTeco] Sending command ${command.commandId} to device ${sn}: ${command.command}`);
            command.status = 'sent';
            command.sentAt = new Date();
            await command.save();
            return res.status(200).type('text/plain').send(command.command);
        }

        return res.status(200).type('text/plain').send('OK');
    } catch (error) {
        console.error('[ZKTeco] GetRequest error:', error);
        return res.status(200).type('text/plain').send('OK');
    }
};

/**
 * Handle Device Command Results — POST /iclock/devicecmd?SN=xxx
 * Devices report whether a command was executed successfully.
 * Ported from Laravel ZKTecoController::handleDeviceCommand
 */
export const handleDeviceCommand = async (req, res) => {
    try {
        const sn = getSN(req);
        const deviceIp = req.headers['x-forwarded-for'] || req.ip || '';
        const userAgent = req.headers['user-agent'] || 'N/A';

        if (!sn) {
            console.log('[ZKTeco] Command execution failed: Missing device SN');
            return res.status(200).type('text/plain').send('OK');
        }

        console.log(`[ZKTeco] Command Result: SN="${sn}" | IP=${deviceIp} | UA=${userAgent}`);

        const device = await BiometricDevice.findOne({ serialNumber: sn });

        if (!device) {
            console.log('[ZKTeco] Command execution failed: Device not found');
            return res.status(200).type('text/plain').send('OK');
        }

        // Update device status on any valid request
        device.status = 'online';
        device.deviceIp = deviceIp;
        device.lastOnline = new Date();
        await device.save();

        // Get the raw request body
        const rawBody = typeof req.body === 'string' ? req.body : '';

        console.log(`[ZKTeco] Device command result from ${sn}: ${rawBody}`);

        // Parse the response body (key=value pairs separated by & or newlines)
        const parsedResponse = {};
        rawBody.replace(/\n/g, '').split('&').forEach(pair => {
            const [key, ...vals] = pair.split('=');
            if (key) parsedResponse[key.trim()] = vals.join('=').trim();
        });

        // Extract command and return code
        const command = parsedResponse['CMD'] || '';
        const returnCode = parsedResponse['Return'] || '';
        const commandId = parsedResponse['ID'] || '';

        console.log('[ZKTeco] Parsed command result:', {
            command,
            return_code: returnCode,
            commandId
        });

        if (!commandId) {
            return res.status(200).type('text/plain').send('OK');
        }

        // Find the pending command by commandId
        const pendingCommand = await BiometricCommand.findOne({ commandId: commandId });

        if (!pendingCommand) {
            console.log(`[ZKTeco] No matching command found for ID: ${commandId}`);
            return res.status(200).type('text/plain').send('OK');
        }

        // Return appropriate response based on the command result
        if (returnCode === '0') {
            await commandExecuted(pendingCommand, device);
            console.log(`[ZKTeco] Command ${commandId} executed successfully`);
        } else {
            await commandFailed(pendingCommand);
            console.warn('[ZKTeco] Command execution failed', { error_code: returnCode });
        }

        return res.status(200).type('text/plain').send('OK');
    } catch (error) {
        console.error('[ZKTeco] HandleDeviceCommand Error:', error);
        return res.status(200).type('text/plain').send('OK');
    }
};

/**
 * Handle Ping Requests
 */
export const handlePing = async (req, res) => {
    const sn = getSN(req);
    if (sn) {
        const device = await BiometricDevice.findOne({ serialNumber: sn });
        if (device) {
            device.status = 'online';
            device.lastOnline = new Date();
            await device.save();
        }
    }
    return res.status(200).setHeader('Content-Type', 'text/plain').send('OK');
};

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Record fingerprint / User data from device
 */
async function recordFingerprint(rows, device) {
    for (const row of rows) {
        if (!row || !row.trim()) continue;

        // Use tab or space as delimiter
        const parts = row.split(/[\t ]+/);
        if (parts.length === 0) continue;

        // Fingerprint data: FP PIN=xxx
        if (parts[0].startsWith('FP')) {
            const employeeIdMatch = row.match(/PIN=([^ \t]+)/i);
            const employeeId = employeeIdMatch ? employeeIdMatch[1] : null;

            let fingerprintId = null;
            let template = null;

            const fidMatch = row.match(/FID=([^ \t]+)/i);
            const tmpMatch = row.match(/TMP=([^ \t]+)/i);

            if (fidMatch) fingerprintId = fidMatch[1];
            if (tmpMatch) template = tmpMatch[1];

            console.log(`[ZKTeco] Fingerprint/User data received for employee: ${employeeId} | FID=${fingerprintId}`);

            if (employeeId && fingerprintId) {
                await BiometricEmployee.findOneAndUpdate(
                    { biometricEmployeeId: employeeId },
                    {
                        hasFingerprint: true,
                        fingerprintId,
                        fingerprintTemplate: template
                    },
                    { upsert: false }
                );
            }
        }

        // User data: USER PIN=xxx
        if (parts[0].startsWith('USER')) {
            const employeeIdMatch = row.match(/PIN=([^ \t]+)/i);
            const employeeId = employeeIdMatch ? employeeIdMatch[1] : null;

            const nameMatch = row.match(/Name=([^ \t\r\n]+)/i);
            const name = nameMatch ? nameMatch[1] : null;

            console.log(`[ZKTeco] User detail received: ID=${employeeId}, Name=${name}`);
        }
    }
}

/**
 * Process attendance rows and mark attendance
 */
async function markAttendanceToDeviceAndApplication(rows, device, req) {
    for (const line of rows) {
        if (!line || !line.trim()) continue;

        // Hyper-resilient delimiter check: split by tab, space, comma, or semicolon
        const parts = line.split(/[\t ,;]+/).filter(p => p.trim().length > 0);
        if (parts.length < 2) continue;

        // ZKTeco Format: [EmployeeID] [YYYY-MM-DD HH:mm:ss] [Status] [VerifyType]
        const deviceEmployeeId = parts[0];

        // Advanced parsing for timestamp which might be in separate parts or joined
        let rawTimestampText = '';
        let rawStatus = '0';

        if (parts[1] && parts[1].includes('-') && parts[2] && parts[2].includes(':')) {
            // parts[1]=YYYY-MM-DD, parts[2]=HH:mm:ss
            rawTimestampText = `${parts[1]} ${parts[2]}`;
            rawStatus = parts[3] || '0';
        } else {
            // Single part timestamp or weird format
            rawTimestampText = parts[1];
            rawStatus = parts[2] || '0';
        }

        // Validate and parse timestamp
        // The device is in India (+05:30) and sends local time. We need to append '+05:30' so the server
        // parses it accurately into UTC regardless of its own local timezone.
        let isoString = rawTimestampText.replace(/ /g, 'T');
        if (!isoString.includes('+') && !isoString.includes('Z')) {
            isoString += '+05:30';
        }

        let timestamp = new Date(isoString);
        if (isNaN(timestamp.getTime())) {
            timestamp = new Date(rawTimestampText + '+05:30');
            if (isNaN(timestamp.getTime())) {
                // Try removing weird characters
                const cleaned = rawTimestampText.replace(/[^0-9- :]/g, '').trim().replace(/ /g, 'T') + '+05:30';
                timestamp = new Date(cleaned);
                if (isNaN(timestamp.getTime())) {
                    console.warn(`[ZKTeco] FAILED parsing timestamp: "${rawTimestampText}"`);
                    continue;
                }
            }
        }

        console.log(`[ZKTeco] ADMS Log: ID=${deviceEmployeeId} Time=${timestamp.toISOString()} Status=${rawStatus}`);

        // Check for duplicate record
        const existingRecord = await BiometricDeviceAttendance.findOne({
            employeeId: deviceEmployeeId,
            timestamp: timestamp,
            deviceSerialNumber: device.serialNumber
        });

        if (existingRecord) continue;

        // Find biometric employee mapping
        let biometricEmployee = await BiometricEmployee.findOne({
            biometricEmployeeId: deviceEmployeeId
        });

        // Determine clock-in (0) or clock-out (1)
        let status = parseInt(rawStatus) || 0;

        // Auto-toggle logic if device sends 0/15 or repeats the same status
        if (status === 0 || status === 15) {
            const startOfDay = new Date(timestamp);
            startOfDay.setHours(0, 0, 0, 0);

            const lastRef = await BiometricDeviceAttendance.findOne({
                employeeId: deviceEmployeeId,
                timestamp: { $gte: startOfDay, $lt: timestamp }
            }).sort({ timestamp: -1 });

            status = (lastRef && lastRef.status1 === 0) ? 1 : 0;
        }

        // Store raw device attendance
        const attendanceData = {
            employee: biometricEmployee?.employee || null,
            deviceName: device.deviceName,
            deviceSerialNumber: device.serialNumber,
            employeeId: deviceEmployeeId,
            timestamp: timestamp,
            status1: status,
            table: req.query.table || '',
            stamp: req.query.Stamp || ''
        };

        try {
            await BiometricDeviceAttendance.create(attendanceData);
        } catch (dupError) {
            if (dupError.code === 11000) continue;
            throw dupError;
        }

        // Auto-match based on employeeId
        if (!biometricEmployee) {
            const emp = await Employee.findOne({ employeeId: deviceEmployeeId });
            if (emp) {
                biometricEmployee = await BiometricEmployee.create({
                    biometricEmployeeId: deviceEmployeeId,
                    employee: emp._id
                });
            }
        }

        // Mark attendance in main model
        if (biometricEmployee?.employee) {
            await markAttendance(biometricEmployee.employee, timestamp, device, req);
        }
    }
}

/**
 * Mark attendance in the main Attendance model
 * Ported from Laravel BiometricEmployee::markAttendance
 */
async function markAttendance(employeeId, timestamp, device, req) {
    try {
        const punchDateTime = new Date(timestamp);
        const attendanceDate = new Date(punchDateTime);
        attendanceDate.setHours(0, 0, 0, 0);

        // Get working hours config
        let workingHours;
        try {
            workingHours = await getWorkingHoursConfig();
        } catch (e) {
            workingHours = { startTime: '09:00', endTime: '18:00', workingHoursPerDay: 8 };
        }

        const configuredStartTime = parseTimeToDate(workingHours.startTime, attendanceDate);

        // Get last attendance for this employee today
        const lastAttendance = await Attendance.findOne({
            employee: employeeId,
            date: attendanceDate
        }).sort({ createdAt: -1 });

        if (!lastAttendance || lastAttendance.checkOut !== null) {
            // Clock In — no record or last record has checkout
            const lateArrival = punchDateTime > configuredStartTime;

            const newAttendance = new Attendance({
                employee: employeeId,
                date: attendanceDate,
                checkIn: punchDateTime,
                lateArrival,
                status: 'Present',
                punchSource: 'biometric',
                device: device.serialNumber,
                notes: `Biometric Check-In from device ${device.deviceName}`
            });
            await newAttendance.save();

            console.log(`[ZKTeco] Clock-In recorded for employee ${employeeId}`);

            // Send socket notification
            emitBiometricNotification(req, employeeId, 'check_in', punchDateTime, device);
        } else if (lastAttendance && lastAttendance.checkOut === null) {
            // Clock Out — update existing record
            const configuredEndTime = parseTimeToDate(workingHours.endTime, attendanceDate);
            const earlyDeparture = punchDateTime < configuredEndTime;

            lastAttendance.checkOut = punchDateTime;
            lastAttendance.earlyDeparture = earlyDeparture;
            lastAttendance.punchSource = 'biometric';
            lastAttendance.device = device.serialNumber;
            lastAttendance.notes = `Biometric Check-Out from device ${device.deviceName}`;

            if (lastAttendance.missedPunch) {
                lastAttendance.missedPunch = false;
                lastAttendance.status = 'Present';
            }

            await lastAttendance.save();

            // Check for half day
            if (lastAttendance.workingHours) {
                const halfDayThreshold = (workingHours.workingHoursPerDay || 8) / 2;
                if (lastAttendance.workingHours < halfDayThreshold) {
                    lastAttendance.status = 'Half Day';
                    await lastAttendance.save();
                }
            }

            console.log(`[ZKTeco] Clock-Out recorded for employee ${employeeId}`);

            emitBiometricNotification(req, employeeId, 'check_out', punchDateTime, device);
        }
    } catch (error) {
        // If duplicate key error (attendance already exists for date), try update
        if (error.code === 11000) {
            console.log('[ZKTeco] Attendance record already exists, attempting update');
            try {
                const attendanceDate = new Date(timestamp);
                attendanceDate.setHours(0, 0, 0, 0);
                const existing = await Attendance.findOne({
                    employee: employeeId,
                    date: attendanceDate
                });
                if (existing && !existing.checkOut) {
                    existing.checkOut = new Date(timestamp);
                    existing.punchSource = 'biometric';
                    existing.device = device.serialNumber;
                    await existing.save();
                }
            } catch (updateErr) {
                console.error('[ZKTeco] Failed to update existing attendance:', updateErr.message);
            }
        } else {
            console.error('[ZKTeco] Mark attendance error:', error.message);
        }
    }
}

/**
 * Command executed successfully — handle side effects
 */
async function commandExecuted(pendingCommand, device) {
    if (pendingCommand.commandId?.startsWith('CREATEUSER')) {
        // Check if biometric employee already exists
        const existing = await BiometricEmployee.findOne({
            biometricEmployeeId: pendingCommand.employeeId
        });

        if (!existing && pendingCommand.employee) {
            await BiometricEmployee.create({
                biometricEmployeeId: pendingCommand.employeeId,
                employee: pendingCommand.employee
            });
        }
    }

    pendingCommand.status = 'executed';
    pendingCommand.executedAt = new Date();
    await pendingCommand.save();
}

/**
 * Mark command as failed
 * Ported from Laravel BiometricCommands::commandFailed
 */
async function commandFailed(pendingCommand) {
    if (!pendingCommand) return;

    pendingCommand.status = 'failed';
    pendingCommand.failedAt = new Date();
    await pendingCommand.save();
}

/**
 * Emit Socket.IO notification for biometric events
 */
function emitBiometricNotification(req, employeeId, action, punchDateTime, device) {
    try {
        const io = req.app.get('io');
        if (!io) return;

        const timeOptions = {
            timeZone: process.env.TIMEZONE || 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        const formattedTime = punchDateTime.toLocaleTimeString('en-IN', timeOptions);

        const notificationData = {
            type: action === 'check_in' ? 'BIOMETRIC_CHECK_IN' : 'BIOMETRIC_CHECK_OUT',
            title: action === 'check_in' ? 'Biometric Check-In' : 'Biometric Check-Out',
            message: `${action === 'check_in' ? 'Checked in' : 'Checked out'} at ${formattedTime} via biometric device`,
            data: {
                employeeId,
                action,
                time: punchDateTime.toISOString(),
                localTime: formattedTime,
                device: device.serialNumber
            },
            timestamp: new Date().toISOString()
        };

        io.to(`user:${employeeId}`).emit('notification', notificationData);
        io.to('admins').emit('notification', notificationData);
    } catch (err) {
        console.error('[ZKTeco] Notification error:', err.message);
    }
}
