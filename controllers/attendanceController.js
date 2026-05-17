import { Attendance, Holiday } from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import { processLateArrival, processEarlyDeparture } from './shortLeaveController.js';
import { notifyAttendanceEvent } from './notificationController.js';
import { getWorkingHoursConfig, parseTimeToDate } from '../utils/workingHoursHelper.js';
import { autoMarkMissedPunches } from '../utils/attendanceHelper.js';

// Helper to get employee record for the current user
const getEmployeeRecord = async (user) => {
    let emp = user.employee;
    if (!emp && user.email) {
        const found = await Employee.findOne({ email: user.email });
        if (found) emp = found;
    }
    return emp;
};

// ============ ATTENDANCE ============

// Get attendance records
export const getAttendance = async (req, res) => {
    try {
        // Auto-mark missed punches before returning data
        await autoMarkMissedPunches();

        const { employee, startDate, endDate, status, department } = req.query;
        const query = {};

        if (employee) {
            query.employee = employee;
        } else if (req.user.role === 'employee' || !req.query.all) {
            // Default to current user's attendance if not explicitly asking for all
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                query.employee = emp._id || emp;
            } else if (req.user.role === 'employee') {
                return res.status(200).json({
                    status: 'success',
                    results: 0,
                    data: []
                });
            }
        }
        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        let attendance = await Attendance.find(query)
            .populate('employee', 'firstName lastName employeeId department designation profileImage')
            .sort({ date: -1 });

        // Filter by department if specified
        if (department) {
            attendance = attendance.filter(a => a.employee?.department === department);
        }

        res.status(200).json({
            status: 'success',
            results: attendance.length,
            data: attendance
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get attendance'
        });
    }
};

// Get single attendance record
export const getAttendanceById = async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id)
            .populate('employee', 'firstName lastName employeeId department designation');

        if (!attendance) {
            return res.status(404).json({
                status: 'error',
                message: 'Attendance record not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: attendance
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get attendance'
        });
    }
};

// Check in
export const checkIn = async (req, res) => {
    try {
        const { ipAddress, device, location, latitude, longitude, accuracy } = req.body;
        let { employee } = req.body;

        // If employee not in body, use the current user's employee record
        if (!employee) {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                employee = emp._id || emp;
            }
        }

        if (!employee) {
            return res.status(400).json({
                status: 'error',
                message: 'Employee ID is required'
            });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if already checked in today
        let attendance = await Attendance.findOne({
            employee,
            date: today
        });

        if (attendance && attendance.checkIn) {
            return res.status(400).json({
                status: 'error',
                message: 'Already checked in today'
            });
        }

        const checkInTime = new Date();

        // Check for late arrival using configured working hours
        const workingHoursConfig = await getWorkingHoursConfig();
        const startTime = parseTimeToDate(workingHoursConfig.startTime);
        const lateArrival = checkInTime > startTime;

        if (attendance) {
            attendance.checkIn = checkInTime;
            attendance.lateArrival = lateArrival;
            attendance.ipAddress = ipAddress;
            attendance.device = device;
            if (location) attendance.location = location;
            await attendance.save();
        } else {
            attendance = await Attendance.create({
                employee,
                date: today,
                checkIn: checkInTime,
                lateArrival,
                status: 'Present',
                ipAddress,
                device,
                location
            });
        }

        const populated = await Attendance.findById(attendance._id)
            .populate('employee', 'firstName lastName employeeId');

        // Notify managers about check-in
        const employeeRecord = await Employee.findById(employee);
        if (employeeRecord) {
            await notifyAttendanceEvent(attendance, employeeRecord, 'checkin', req.app);
        }

        // Process short leave if late arrival detected
        let shortLeaveEntry = null;
        if (lateArrival) {
            try {
                shortLeaveEntry = await processLateArrival(employee, checkInTime, attendance._id);
            } catch (e) {
                console.error('Short leave processing error:', e);
            }
        }

        // Initialize AttendanceLocation record automatically
        try {
            const AttendanceLocation = (await import('../models/AttendanceLocation.js')).default;
            let locationRecord = await AttendanceLocation.findOne({ attendance: attendance._id });

            if (!locationRecord) {
                locationRecord = new AttendanceLocation({
                    attendance: attendance._id,
                    employee: attendance.employee,
                    date: today,
                    trackingStatus: 'Active',
                    trackingStartedAt: new Date(),
                    deviceInfo: {
                        platform: 'web',
                        deviceName: device || 'unknown',
                        appVersion: '1.0.0'
                    }
                });

                // Add initial location if provided in check-in body
                if (latitude && longitude) {
                    locationRecord.addHourlyLocation([longitude, latitude], location, new Date(), accuracy);
                }

                await locationRecord.save();
            }
        } catch (error) {
            console.error('Error auto-initializing location tracking:', error);
        }

        res.status(200).json({
            status: 'success',
            message: 'Checked in successfully',
            data: populated,
            locationTrackingRequired: true, // Client should start location tracking
            attendanceId: attendance._id,
            shortLeave: shortLeaveEntry ? {
                minutesLate: shortLeaveEntry.minutesUsed,
                status: shortLeaveEntry.status
            } : null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to check in'
        });
    }
};

// Check out
export const checkOut = async (req, res) => {
    try {
        let { employee } = req.body;

        // If employee not in body, use the current user's employee record
        if (!employee) {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                employee = emp._id || emp;
            }
        }

        if (!employee) {
            return res.status(400).json({
                status: 'error',
                message: 'Employee ID is required'
            });
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const attendance = await Attendance.findOne({
            employee,
            date: today
        });

        if (!attendance) {
            return res.status(400).json({
                status: 'error',
                message: 'No check-in found for today'
            });
        }

        // Allow multiple check-outs: overwrite with latest time
        const checkOutTime = new Date();

        // Check for early departure using configured working hours
        const workingHoursConfig = await getWorkingHoursConfig();
        const endTime = parseTimeToDate(workingHoursConfig.endTime);
        const earlyDeparture = checkOutTime < endTime;

        attendance.checkOut = checkOutTime;
        attendance.earlyDeparture = earlyDeparture;
        attendance.punchSource = 'web'; // Default for this controller

        // Clear missed punch flag if it was set
        if (attendance.missedPunch || attendance.status === 'Missed Punch') {
            attendance.missedPunch = false;
            attendance.status = 'Present';
            attendance.notes = (attendance.notes || '') + ' | Missed punch recovered by manual check-out';
        }

        // Check for half day (less than half of configured working hours)
        const halfDayThreshold = workingHoursConfig.workingHoursPerDay / 2;

        // Let the pre-save hook calculate workingHours first
        await attendance.save();

        if (attendance.workingHours < halfDayThreshold) {
            attendance.status = 'Half Day';
            await attendance.save();
        }

        const populated = await Attendance.findById(attendance._id)
            .populate('employee', 'firstName lastName employeeId');

        // Notify managers about check-out
        const employeeRecord = await Employee.findById(employee);
        if (employeeRecord) {
            await notifyAttendanceEvent(attendance, employeeRecord, 'checkout', req.app);
        }

        // Process short leave if early departure detected
        let shortLeaveEntry = null;
        if (earlyDeparture) {
            try {
                shortLeaveEntry = await processEarlyDeparture(employee, checkOutTime, attendance._id);
            } catch (e) {
                console.error('Short leave processing error:', e);
            }
        }

        res.status(200).json({
            status: 'success',
            message: 'Checked out successfully',
            data: populated,
            shortLeave: shortLeaveEntry ? {
                minutesEarly: shortLeaveEntry.minutesUsed,
                status: shortLeaveEntry.status
            } : null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to check out'
        });
    }
};

// Mark attendance manually (admin)
export const markAttendance = async (req, res) => {
    try {
        const { employee, date, status, checkIn, checkOut, notes } = req.body;

        const attendanceDate = new Date(date);
        attendanceDate.setHours(0, 0, 0, 0);

        const attendance = await Attendance.findOneAndUpdate(
            { employee, date: attendanceDate },
            {
                status,
                checkIn: checkIn ? new Date(checkIn) : undefined,
                checkOut: checkOut ? new Date(checkOut) : undefined,
                notes
            },
            { new: true, upsert: true, runValidators: true }
        ).populate('employee', 'firstName lastName employeeId department');

        res.status(200).json({
            status: 'success',
            data: attendance
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to mark attendance'
        });
    }
};

// Get attendance summary/stats
export const getAttendanceStats = async (req, res) => {
    try {
        // Auto-mark missed punches before computing stats
        await autoMarkMissedPunches();

        const { startDate, endDate, employeeId } = req.query;
        let employee = employeeId;

        if (req.user.role === 'employee') {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                employee = emp._id || emp;
            }
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dateQuery = startDate && endDate ? {
            date: { $gte: new Date(startDate), $lte: new Date(endDate) }
        } : { date: today };

        if (employee) {
            dateQuery.employee = employee;
        }

        const [present, absent, onLeave, halfDay, lateArrivals, missedPunch] = await Promise.all([
            Attendance.countDocuments({ ...dateQuery, status: 'Present' }),
            Attendance.countDocuments({ ...dateQuery, status: 'Absent' }),
            Attendance.countDocuments({ ...dateQuery, status: 'On Leave' }),
            Attendance.countDocuments({ ...dateQuery, status: 'Half Day' }),
            Attendance.countDocuments({ ...dateQuery, lateArrival: true }),
            Attendance.countDocuments({ ...dateQuery, status: 'Missed Punch' })
        ]);

        const totalEmployees = await Employee.countDocuments({ status: 'Active' });

        res.status(200).json({
            status: 'success',
            data: {
                totalEmployees,
                present,
                absent,
                onLeave,
                halfDay,
                lateArrivals,
                missedPunch,
                attendanceRate: totalEmployees > 0
                    ? ((present + halfDay) / totalEmployees * 100).toFixed(1)
                    : 0
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get attendance stats'
        });
    }
};

// Get monthly attendance report
export const getMonthlyReport = async (req, res) => {
    try {
        const { month, year, employee } = req.query;
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        const query = {
            date: { $gte: startDate, $lte: endDate }
        };

        // If user is basic employee, force filter by their employee ID
        if (req.user.role === 'employee') {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                query.employee = emp._id || emp;
            }
        } else if (employee) {
            query.employee = employee;
        }

        const attendance = await Attendance.find(query)
            .populate('employee', 'firstName lastName employeeId department')
            .sort({ date: 1 });

        // Group by employee
        const report = {};
        attendance.forEach(record => {
            const empId = record.employee._id.toString();
            if (!report[empId]) {
                report[empId] = {
                    employee: record.employee,
                    records: [],
                    summary: {
                        present: 0,
                        absent: 0,
                        halfDay: 0,
                        onLeave: 0,
                        lateArrivals: 0,
                        totalWorkingHours: 0,
                        totalOvertime: 0
                    }
                };
            }
            report[empId].records.push(record);

            // Update summary
            if (record.status === 'Present') report[empId].summary.present++;
            if (record.status === 'Absent') report[empId].summary.absent++;
            if (record.status === 'Half Day') report[empId].summary.halfDay++;
            if (record.status === 'On Leave') report[empId].summary.onLeave++;
            if (record.lateArrival) report[empId].summary.lateArrivals++;
            report[empId].summary.totalWorkingHours += record.workingHours || 0;
            report[empId].summary.totalOvertime += record.overtime || 0;
        });

        res.status(200).json({
            status: 'success',
            data: Object.values(report)
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get monthly report'
        });
    }
};

// ============ HOLIDAYS ============

// Get all holidays
export const getHolidays = async (req, res) => {
    try {
        const { year } = req.query;
        const query = {};

        if (year) {
            const startDate = new Date(year, 0, 1);
            const endDate = new Date(year, 11, 31);
            query.date = { $gte: startDate, $lte: endDate };
        }

        const holidays = await Holiday.find(query).sort({ date: 1 });

        res.status(200).json({
            status: 'success',
            results: holidays.length,
            data: holidays
        });
    } catch (error) {
        console.error('getHolidays error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get holidays'
        });
    }
};

// Create holiday
export const createHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.create(req.body);
        res.status(201).json({
            status: 'success',
            data: holiday
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create holiday'
        });
    }
};

// Update holiday
export const updateHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: holiday
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update holiday'
        });
    }
};

// Delete holiday
export const deleteHoliday = async (req, res) => {
    try {
        const holiday = await Holiday.findByIdAndDelete(req.params.id);

        if (!holiday) {
            return res.status(404).json({
                status: 'error',
                message: 'Holiday not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete holiday'
        });
    }
};
