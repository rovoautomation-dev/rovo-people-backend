import AttendanceLocation from '../models/AttendanceLocation.js';
import { Attendance } from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import { createNotification } from './notificationController.js';

// Helper to get employee record for the current user
const getEmployeeRecord = async (user) => {
    let emp = user.employee;
    if (!emp && user.email) {
        const found = await Employee.findOne({ email: user.email });
        if (found) emp = found;
    }
    return emp;
};

// ============ START TRACKING ============

// Start location tracking after check-in
export const startTracking = async (req, res) => {
    try {
        const { id } = req.params; // Attendance ID
        const { platform, deviceName, appVersion } = req.body;

        const attendance = await Attendance.findById(id);
        if (!attendance) {
            return res.status(404).json({
                status: 'error',
                message: 'Attendance record not found'
            });
        }

        // Check if tracking already exists
        let locationRecord = await AttendanceLocation.findOne({ attendance: id });

        if (locationRecord && locationRecord.trackingStatus === 'Active') {
            return res.status(200).json({
                status: 'success',
                message: 'Tracking already active',
                data: locationRecord
            });
        }

        if (!locationRecord) {
            // Create new tracking record
            locationRecord = new AttendanceLocation({
                attendance: id,
                employee: attendance.employee,
                date: attendance.date,
                trackingStatus: 'Active',
                trackingStartedAt: new Date(),
                deviceInfo: {
                    platform: platform || 'unknown',
                    deviceName: deviceName || 'unknown',
                    appVersion: appVersion || '1.0.0'
                }
            });

            // Add initial location if provided
            const { latitude, longitude, address, accuracy } = req.body;
            if (latitude && longitude) {
                locationRecord.addHourlyLocation([longitude, latitude], address, new Date(), accuracy);
            }

            await locationRecord.save();
        } else {
            // Resume tracking
            locationRecord.trackingStatus = 'Active';
            locationRecord.trackingStartedAt = new Date();

            // Add resume location if provided
            const { latitude, longitude, address, accuracy } = req.body;
            if (latitude && longitude) {
                locationRecord.addHourlyLocation([longitude, latitude], address, new Date(), accuracy);
            }

            await locationRecord.save();
        }

        res.status(200).json({
            status: 'success',
            message: 'Location tracking started',
            data: locationRecord
        });
    } catch (error) {
        console.error('Error starting tracking:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to start tracking'
        });
    }
};

// ============ STOP TRACKING ============

// Stop location tracking (on check-out)
export const stopTracking = async (req, res) => {
    try {
        const { id } = req.params; // Attendance ID

        const locationRecord = await AttendanceLocation.findOne({ attendance: id });

        if (!locationRecord) {
            return res.status(404).json({
                status: 'error',
                message: 'No tracking record found'
            });
        }

        locationRecord.trackingStatus = 'Stopped';
        locationRecord.trackingStoppedAt = new Date();
        await locationRecord.save();

        res.status(200).json({
            status: 'success',
            message: 'Location tracking stopped',
            data: {
                totalDistance: locationRecord.totalDistance,
                locationsRecorded: locationRecord.locationHistory.length,
                trackingDuration: locationRecord.trackingStoppedAt - locationRecord.trackingStartedAt
            }
        });
    } catch (error) {
        console.error('Error stopping tracking:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to stop tracking'
        });
    }
};

// ============ UPDATE LOCATION ============

// Save hourly location update
export const updateLocation = async (req, res) => {
    try {
        const { id } = req.params; // Attendance ID
        const { latitude, longitude, address, accuracy } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({
                status: 'error',
                message: 'Latitude and longitude are required'
            });
        }

        let locationRecord = await AttendanceLocation.findOne({ attendance: id });

        if (!locationRecord) {
            // Auto-create tracking record if doesn't exist
            const attendance = await Attendance.findById(id);
            if (!attendance) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Attendance record not found'
                });
            }

            locationRecord = await AttendanceLocation.create({
                attendance: id,
                employee: attendance.employee,
                date: attendance.date,
                trackingStatus: 'Active',
                trackingStartedAt: new Date()
            });
        }

        if (locationRecord.trackingStatus !== 'Active') {
            return res.status(400).json({
                status: 'error',
                message: 'Tracking is not active'
            });
        }

        // Add hourly location
        const coordinates = [longitude, latitude]; // GeoJSON format
        const timestamp = new Date();

        locationRecord.addHourlyLocation(coordinates, address, timestamp, accuracy);
        await locationRecord.save();

        // Emit real-time update via Socket.IO if available
        if (req.app.get('io')) {
            const io = req.app.get('io');
            io.emit('attendance-location-update', {
                attendanceId: id,
                employeeId: locationRecord.employee.toString(),
                location: {
                    latitude,
                    longitude,
                    address,
                    timestamp
                }
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Location updated',
            data: {
                hour: new Date(timestamp).getHours(),
                totalLocations: locationRecord.locationHistory.length,
                totalDistance: locationRecord.totalDistance
            }
        });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update location'
        });
    }
};

// ============ GET LOCATION HISTORY ============

// Get location history for an attendance record
export const getLocationHistory = async (req, res) => {
    try {
        const { id } = req.params; // Attendance ID

        const locationRecord = await AttendanceLocation.findOne({ attendance: id })
            .populate('employee', 'firstName lastName employeeId profileImage')
            .populate('attendance', 'date checkIn checkOut status');

        if (!locationRecord) {
            return res.status(404).json({
                status: 'error',
                message: 'No location history found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: locationRecord
        });
    } catch (error) {
        console.error('Error getting location history:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get location history'
        });
    }
};

// ============ GET EMPLOYEE LOCATION HISTORY ============

// Get all location records for an employee
export const getEmployeeLocationHistory = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        const query = { employee: employeeId };

        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const locationRecords = await AttendanceLocation.find(query)
            .populate('attendance', 'date checkIn checkOut status')
            .sort({ date: -1 });

        res.status(200).json({
            status: 'success',
            results: locationRecords.length,
            data: locationRecords
        });
    } catch (error) {
        console.error('Error getting employee location history:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get employee location history'
        });
    }
};

// ============ LOCATION PERMISSION ALERTS ============

// Report location permission disabled
export const reportLocationDisabled = async (req, res) => {
    try {
        const { attendanceId, employeeId } = req.body;

        // Find current tracking record
        let locationRecord;
        if (attendanceId) {
            locationRecord = await AttendanceLocation.findOne({ attendance: attendanceId });
        } else if (employeeId) {
            // Find most recent active tracking for this employee
            locationRecord = await AttendanceLocation.findOne({
                employee: employeeId,
                trackingStatus: 'Active'
            }).sort({ createdAt: -1 });
        }

        if (locationRecord) {
            locationRecord.recordPermissionDisabled();
            await locationRecord.save();
        }

        // Get employee details
        const employee = await Employee.findById(employeeId || locationRecord?.employee);
        if (!employee) {
            return res.status(404).json({
                status: 'error',
                message: 'Employee not found'
            });
        }

        // Find admins and managers to notify
        const User = (await import('../models/User.js')).default;
        const managersAndAdmins = await User.find({
            role: { $in: ['admin', 'manager'] },
            isActive: true
        });

        // Send notifications
        for (const user of managersAndAdmins) {
            await createNotification({
                userId: user._id,
                title: 'Location Permission Disabled',
                message: `${employee.firstName} ${employee.lastName} has disabled location permission while tracking`,
                type: 'alert',
                category: 'attendance',
                priority: 'high'
            }, req.app);

            // Record who was notified
            if (locationRecord) {
                const lastEvent = locationRecord.permissionDisableHistory[locationRecord.permissionDisableHistory.length - 1];
                if (lastEvent) {
                    lastEvent.notifiedTo.push(user._id);
                }
            }
        }

        if (locationRecord) {
            await locationRecord.save();
        }

        // Emit real-time alert
        if (req.app.get('io')) {
            const io = req.app.get('io');
            io.emit('location-permission-disabled', {
                employeeId: employee._id,
                employeeName: `${employee.firstName} ${employee.lastName}`,
                timestamp: new Date()
            });
        }

        res.status(200).json({
            status: 'success',
            message: 'Alert sent to admins and managers'
        });
    } catch (error) {
        console.error('Error reporting location disabled:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to report location disabled'
        });
    }
};

// Report location permission re-enabled
export const reportLocationEnabled = async (req, res) => {
    try {
        const { attendanceId, employeeId } = req.body;

        let locationRecord;
        if (attendanceId) {
            locationRecord = await AttendanceLocation.findOne({ attendance: attendanceId });
        } else if (employeeId) {
            locationRecord = await AttendanceLocation.findOne({
                employee: employeeId,
                trackingStatus: 'Active'
            }).sort({ createdAt: -1 });
        }

        if (locationRecord) {
            locationRecord.recordPermissionEnabled();
            await locationRecord.save();
        }

        res.status(200).json({
            status: 'success',
            message: 'Permission re-enabled recorded'
        });
    } catch (error) {
        console.error('Error reporting location enabled:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to report location enabled'
        });
    }
};

// ============ GET PERMISSION DISABLE HISTORY ============

// Get history of permission disable events
export const getPermissionDisableHistory = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { startDate, endDate } = req.query;

        const query = { employee: employeeId };

        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        const records = await AttendanceLocation.find(query)
            .select('date permissionDisableHistory')
            .populate('attendance', 'date')
            .sort({ date: -1 });

        // Flatten permission events
        const events = [];
        for (const record of records) {
            for (const event of record.permissionDisableHistory) {
                events.push({
                    date: record.date,
                    ...event.toObject()
                });
            }
        }

        res.status(200).json({
            status: 'success',
            results: events.length,
            data: events
        });
    } catch (error) {
        console.error('Error getting permission history:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get permission history'
        });
    }
};

// ============ GET CURRENT TRACKING STATUS ============

// Get current tracking status for today's attendance
export const getCurrentTrackingStatus = async (req, res) => {
    try {
        const emp = await getEmployeeRecord(req.user);
        if (!emp) {
            return res.status(400).json({
                status: 'error',
                message: 'Employee record not found'
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await Attendance.findOne({
            employee: emp._id || emp,
            date: today
        });

        if (!attendance) {
            return res.status(200).json({
                status: 'success',
                data: {
                    hasAttendance: false,
                    isTracking: false
                }
            });
        }

        const locationRecord = await AttendanceLocation.findOne({ attendance: attendance._id });

        res.status(200).json({
            status: 'success',
            data: {
                hasAttendance: true,
                attendanceId: attendance._id,
                isCheckedIn: !!attendance.checkIn,
                isCheckedOut: !!attendance.checkOut,
                isTracking: locationRecord?.trackingStatus === 'Active',
                lastLocation: locationRecord?.lastLocation,
                totalLocations: locationRecord?.locationHistory?.length || 0,
                totalDistance: locationRecord?.totalDistance || 0
            }
        });
    } catch (error) {
        console.error('Error getting tracking status:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get tracking status'
        });
    }
};
