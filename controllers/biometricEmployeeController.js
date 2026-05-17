import BiometricEmployee from '../models/BiometricEmployee.js';
import BiometricCommand from '../models/BiometricCommand.js';
import BiometricDevice from '../models/BiometricDevice.js';
import BiometricDeviceAttendance from '../models/BiometricDeviceAttendance.js';
import Employee from '../models/Employee.js';

/**
 * Biometric Employee Controller
 * Handles employee-to-biometric-device mapping and attendance log queries
 */

/**
 * Get all employees with their biometric mapping info
 */
export const getEmployees = async (req, res) => {
    try {
        const employees = await Employee.find({ status: 'Active' })
            .select('employeeId firstName lastName email designation profileImage status')
            .sort({ firstName: 1 });

        const biometricMappings = await BiometricEmployee.find()
            .select('employee biometricEmployeeId hasFingerprint');

        const mappingMap = {};
        biometricMappings.forEach(bm => {
            mappingMap[bm.employee?.toString()] = bm;
        });

        const data = employees.map(emp => ({
            _id: emp._id,
            employeeId: emp.employeeId,
            firstName: emp.firstName,
            lastName: emp.lastName,
            email: emp.email,
            designation: emp.designation,
            profileImage: emp.profileImage,
            status: emp.status,
            biometricEmployeeId: mappingMap[emp._id.toString()]?.biometricEmployeeId || '',
            hasFingerprint: mappingMap[emp._id.toString()]?.hasFingerprint || false,
            isMapped: !!mappingMap[emp._id.toString()]
        }));

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('[Biometric] Error fetching employees:', error);
        return res.status(500).json({ success: false, message: 'Error fetching employees' });
    }
};

/**
 * Save biometric ID mappings for employees
 */
export const mapEmployees = async (req, res) => {
    try {
        const { mappings } = req.body;
        // mappings: [{ employeeId: ObjectId, biometricEmployeeId: string }]

        if (!mappings || !Array.isArray(mappings)) {
            return res.status(400).json({
                success: false,
                message: 'Mappings array is required'
            });
        }

        let savedCount = 0;

        for (const mapping of mappings) {
            if (!mapping.employeeId || !mapping.biometricEmployeeId) continue;

            await BiometricEmployee.findOneAndUpdate(
                { employee: mapping.employeeId },
                {
                    employee: mapping.employeeId,
                    biometricEmployeeId: mapping.biometricEmployeeId.trim()
                },
                { upsert: true, new: true }
            );

            // Also update any unlinked attendance records
            await BiometricDeviceAttendance.updateMany(
                {
                    employeeId: mapping.biometricEmployeeId.trim(),
                    employee: null
                },
                { employee: mapping.employeeId }
            );

            savedCount++;
        }

        return res.status(200).json({
            success: true,
            message: `${savedCount} employee mapping(s) saved successfully`
        });
    } catch (error) {
        console.error('[Biometric] Error mapping employees:', error);
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Duplicate biometric ID detected. Each biometric ID must be unique.'
            });
        }
        return res.status(500).json({ success: false, message: 'Error saving mappings' });
    }
};

/**
 * Remove employee from biometric device(s)
 * Deletes mapping + queues DELETEUSER commands for all devices
 */
export const removeFromDevice = async (req, res) => {
    try {
        const { id } = req.params;

        const biometricEmployee = await BiometricEmployee.findOne({ employee: id });

        if (!biometricEmployee) {
            return res.status(404).json({
                success: false,
                message: 'Employee biometric mapping not found'
            });
        }

        // Get all devices
        const devices = await BiometricDevice.find();

        // Create DELETEUSER commands for each device
        for (const device of devices) {
            const biometricCommand = await BiometricCommand.create({
                type: 'DELETEUSER',
                commandId: `TEMP-${Date.now()}`,
                employee: id,
                employeeId: biometricEmployee.biometricEmployeeId,
                deviceSerialNumber: device.serialNumber,
                command: `TEMP-${Date.now()}`,
                status: 'pending'
            });

            biometricCommand.commandId = `DELETEUSER-${biometricCommand._id}`;
            biometricCommand.command = BiometricCommand.deleteUserCommand(
                biometricCommand._id,
                biometricEmployee.biometricEmployeeId
            );
            await biometricCommand.save();
        }

        // Delete the mapping
        await biometricEmployee.deleteOne();

        return res.status(200).json({
            success: true,
            message: 'Employee removed from biometric device(s). Delete commands queued.'
        });
    } catch (error) {
        console.error('[Biometric] Error removing employee from device:', error);
        return res.status(500).json({ success: false, message: 'Error removing employee' });
    }
};

/**
 * Query employee info from biometric device
 * Queues a QUERYUSER command for all devices
 */
export const getEmployeeInfo = async (req, res) => {
    try {
        const { id } = req.params;

        const biometricEmployee = await BiometricEmployee.findOne({ employee: id });

        if (!biometricEmployee) {
            return res.status(404).json({
                success: false,
                message: 'Employee biometric mapping not found'
            });
        }

        const devices = await BiometricDevice.find();

        for (const device of devices) {
            const biometricCommand = await BiometricCommand.create({
                type: 'QUERYUSER',
                commandId: `TEMP-${Date.now()}`,
                deviceSerialNumber: device.serialNumber,
                employee: id,
                employeeId: biometricEmployee.biometricEmployeeId,
                command: `TEMP-${Date.now()}`,
                status: 'pending'
            });

            biometricCommand.commandId = `QUERYUSER-${biometricCommand._id}`;
            biometricCommand.command = BiometricCommand.queryUserCommand(
                biometricCommand._id,
                biometricEmployee.biometricEmployeeId
            );
            await biometricCommand.save();
        }

        return res.status(200).json({
            success: true,
            message: 'Query commands sent to all devices',
            data: {
                biometricId: biometricEmployee.biometricEmployeeId,
                hasFingerprint: biometricEmployee.hasFingerprint,
                fingerprintId: biometricEmployee.fingerprintId
            }
        });
    } catch (error) {
        console.error('[Biometric] Error querying employee info:', error);
        return res.status(500).json({ success: false, message: 'Error querying employee info' });
    }
};

/**
 * Get biometric device attendance logs (raw records)
 */
export const getBiometricAttendance = async (req, res) => {
    try {
        const { page = 1, limit = 50, employeeId, fromDate, toDate, deviceSerial } = req.query;

        const query = {};

        if (employeeId) {
            query.employeeId = employeeId;
        }

        if (deviceSerial) {
            query.deviceSerialNumber = deviceSerial.toUpperCase();
        }

        if (fromDate || toDate) {
            query.timestamp = {};
            if (fromDate) query.timestamp.$gte = new Date(fromDate);
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                query.timestamp.$lte = end;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const logs = await BiometricDeviceAttendance.find(query)
            .populate('employee', 'employeeId firstName lastName')
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await BiometricDeviceAttendance.countDocuments(query);

        return res.status(200).json({
            success: true,
            data: {
                logs,
                total,
                page: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[Biometric] Error fetching attendance logs:', error);
        return res.status(500).json({ success: false, message: 'Error fetching attendance logs' });
    }
};
