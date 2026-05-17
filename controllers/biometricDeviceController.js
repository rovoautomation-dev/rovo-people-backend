import BiometricDevice from '../models/BiometricDevice.js';
import BiometricCommand from '../models/BiometricCommand.js';
import BiometricEmployee from '../models/BiometricEmployee.js';
import Employee from '../models/Employee.js';

/**
 * Biometric Device Management Controller
 * Handles CRUD operations for biometric devices + employee sync to devices
 */

/**
 * Get all biometric devices
 * Auto-marks devices offline if last online > 20 minutes ago
 */
export const getDevices = async (req, res) => {
    try {
        const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

        // Only mark as offline if it was previously online and is now silent
        // If lastOnline is null, it stays 'pending' until the first connection
        await BiometricDevice.updateMany(
            {
                lastOnline: { $ne: null, $lt: twentyMinutesAgo },
                status: { $ne: 'offline' }
            },
            { status: 'offline' }
        );

        const devices = await BiometricDevice.find().sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            data: devices
        });
    } catch (error) {
        console.error('[Biometric] Error fetching devices:', error);
        return res.status(500).json({ success: false, message: 'Error fetching devices' });
    }
};

/**
 * Add a new biometric device
 */
export const addDevice = async (req, res) => {
    try {
        const { deviceName, serialNumber } = req.body;

        if (!deviceName || !serialNumber) {
            return res.status(400).json({
                success: false,
                message: 'Device name and serial number are required'
            });
        }

        // Check for duplicate serial number
        const existing = await BiometricDevice.findOne({
            serialNumber: serialNumber.toUpperCase()
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'A device with this serial number already exists'
            });
        }

        const device = await BiometricDevice.create({
            deviceName: deviceName.trim(),
            serialNumber: serialNumber.toUpperCase().trim(),
            status: 'pending'
        });

        return res.status(201).json({
            success: true,
            message: 'Biometric device added successfully',
            data: device
        });
    } catch (error) {
        console.error('[Biometric] Error adding device:', error);
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A device with this serial number already exists'
            });
        }
        return res.status(500).json({ success: false, message: 'Error adding device' });
    }
};

/**
 * Delete a biometric device
 */
export const deleteDevice = async (req, res) => {
    try {
        const device = await BiometricDevice.findByIdAndDelete(req.params.id);

        if (!device) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }

        // Also delete related commands for this device
        await BiometricCommand.deleteMany({ deviceSerialNumber: device.serialNumber });

        return res.status(200).json({
            success: true,
            message: 'Device deleted successfully'
        });
    } catch (error) {
        console.error('[Biometric] Error deleting device:', error);
        return res.status(500).json({ success: false, message: 'Error deleting device' });
    }
};

/**
 * Get employees list with their biometric sync status
 */
export const getEmployeesToSync = async (req, res) => {
    try {
        const employees = await Employee.find({ status: 'Active' })
            .select('employeeId firstName lastName email profileImage')
            .sort({ firstName: 1 });

        const biometricEmployees = await BiometricEmployee.find()
            .select('employee biometricEmployeeId hasFingerprint');

        // Create a map of employee -> biometric mapping
        const biometricMap = {};
        biometricEmployees.forEach(be => {
            biometricMap[be.employee?.toString()] = {
                biometricId: be.biometricEmployeeId,
                hasFingerprint: be.hasFingerprint
            };
        });

        const data = employees.map(emp => ({
            id: emp._id,
            name: `${emp.firstName} ${emp.lastName}`,
            email: emp.email,
            employeeId: emp.employeeId || '--',
            imageUrl: emp.profileImage?.url || null,
            biometricId: biometricMap[emp._id.toString()]?.biometricId || '--',
            hasFingerprint: biometricMap[emp._id.toString()]?.hasFingerprint || false,
            isConfigured: !!biometricMap[emp._id.toString()]
        }));

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[Biometric] Error fetching employees to sync:', error);
        return res.status(500).json({ success: false, message: 'Error fetching employees' });
    }
};

/**
 * Push selected employees to all active biometric devices
 * Creates CREATEUSER commands for each employee on each device
 */
export const pushEmployeesToDevices = async (req, res) => {
    try {
        const { employeeIds } = req.body;

        if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please select at least one employee'
            });
        }

        // Get all active devices
        const devices = await BiometricDevice.find({ status: { $ne: 'offline' } });

        if (devices.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No active biometric devices found. Please ensure at least one device is online.'
            });
        }

        // Get employees with their biometric IDs
        const employees = await Employee.find({ _id: { $in: employeeIds } })
            .select('employeeId firstName lastName');

        let commandsCreated = 0;

        for (const device of devices) {
            for (const employee of employees) {
                const employeeBiometricId = employee.employeeId || employee._id.toString().slice(-8);

                // Create the command
                const biometricCommand = await BiometricCommand.create({
                    type: 'CREATEUSER',
                    commandId: `TEMP-${Date.now()}`,
                    employee: employee._id,
                    employeeId: employeeBiometricId,
                    deviceSerialNumber: device.serialNumber,
                    command: `TEMP-${Date.now()}`,
                    status: 'pending'
                });

                // Update with actual command string
                biometricCommand.commandId = `CREATEUSER-${biometricCommand._id}`;
                biometricCommand.command = BiometricCommand.createUserCommand(
                    biometricCommand._id,
                    employeeBiometricId,
                    `${employee.firstName} ${employee.lastName}`
                );
                await biometricCommand.save();

                commandsCreated++;
            }
        }

        return res.status(200).json({
            success: true,
            message: `${commandsCreated} sync commands created for ${employees.length} employee(s) across ${devices.length} device(s). Commands will be sent when devices next poll.`
        });
    } catch (error) {
        console.error('[Biometric] Error pushing employees to devices:', error);
        return res.status(500).json({ success: false, message: 'Error syncing employees' });
    }
};

/**
 * Get all biometric commands
 */
export const getCommands = async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;

        const query = {};
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const commands = await BiometricCommand.find(query)
            .populate('employee', 'employeeId firstName lastName')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await BiometricCommand.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: {
                commands,
                total,
                page: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[Biometric] Error fetching commands:', error);
        return res.status(500).json({ success: false, message: 'Error fetching commands' });
    }
};
