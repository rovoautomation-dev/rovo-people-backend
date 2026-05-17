import { ShortLeaveConfig, ShortLeaveRecord, ShortLeaveEntry, ShortLeaveHistory } from '../models/ShortLeave.js';
import { Attendance } from '../models/Attendance.js';
import Employee from '../models/Employee.js';
import { createNotification } from './notificationController.js';

// ============ HELPER FUNCTIONS ============

// Get or create the singleton config
const getOrCreateConfig = async () => {
    let config = await ShortLeaveConfig.findOne();
    if (!config) {
        config = await ShortLeaveConfig.create({});
    }
    return config;
};

// Get employee record for user
const getEmployeeRecord = async (user) => {
    let emp = user.employee;
    if (!emp && user.email) {
        const found = await Employee.findOne({ email: user.email });
        if (found) emp = found;
    }
    return emp;
};

// Get or create monthly record for employee
const getOrCreateMonthlyRecord = async (employeeId, year, month, quotaMinutes = 240) => {
    let record = await ShortLeaveRecord.findOne({
        employee: employeeId,
        year,
        month
    });

    if (!record) {
        record = await ShortLeaveRecord.create({
            employee: employeeId,
            year,
            month,
            totalQuotaMinutes: quotaMinutes,
            status: 'Active'
        });
    }

    return record;
};

// Create history entry
const createHistoryEntry = async (entryId, employeeId, action, previousStatus, newStatus, minutesAffected, performedBy, comment = '', metadata = {}) => {
    await ShortLeaveHistory.create({
        entry: entryId,
        employee: employeeId,
        action,
        previousStatus,
        newStatus,
        minutesAffected,
        performedBy,
        comment,
        metadata
    });
};

// Parse time string (HH:mm) to Date object for today
const parseTimeToDate = (timeString, baseDate = new Date()) => {
    const [hours, minutes] = timeString.split(':').map(Number);
    const date = new Date(baseDate);
    date.setHours(hours, minutes, 0, 0);
    return date;
};

// ============ CONFIGURATION ============

// Get short leave configuration
export const getShortLeaveConfig = async (req, res) => {
    try {
        const config = await getOrCreateConfig();

        res.status(200).json({
            status: 'success',
            data: config
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get short leave configuration'
        });
    }
};

// Update short leave configuration
export const updateShortLeaveConfig = async (req, res) => {
    try {
        const allowedFields = [
            'monthlyQuotaMinutes',
            'graceMinutes',
            'autoDeductOnCheckIn',
            'autoDeductOnCheckOut',
            'autoHalfDayConversion',
            'halfDayThresholdMinutes',
            'requireApproval',
            'isActive'
        ];

        const updates = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });
        updates.updatedBy = req.user._id;

        let config = await ShortLeaveConfig.findOne();
        if (!config) {
            config = await ShortLeaveConfig.create(updates);
        } else {
            config = await ShortLeaveConfig.findOneAndUpdate(
                {},
                updates,
                { new: true, runValidators: true }
            );
        }

        res.status(200).json({
            status: 'success',
            data: config
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update short leave configuration'
        });
    }
};

// ============ MONTHLY BALANCE ============

// Get current user's monthly balance
export const getMyMonthlyBalance = async (req, res) => {
    try {
        const emp = await getEmployeeRecord(req.user);
        const config = await getOrCreateConfig();

        if (!emp) {
            return res.status(200).json({
                status: 'success',
                data: {
                    year: req.query.year ? parseInt(req.query.year) : new Date().getFullYear(),
                    month: req.query.month ? parseInt(req.query.month) : new Date().getMonth() + 1,
                    totalQuotaMinutes: config.monthlyQuotaMinutes,
                    usedMinutes: 0,
                    pendingMinutes: 0,
                    approvedMinutes: 0,
                    status: 'Active',
                    halfDaysConverted: 0,
                    config: {
                        monthlyQuotaMinutes: config.monthlyQuotaMinutes,
                        requireApproval: config.requireApproval
                    }
                }
            });
        }

        const { year, month } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

        const record = await getOrCreateMonthlyRecord(
            emp._id || emp,
            targetYear,
            targetMonth,
            config.monthlyQuotaMinutes
        );

        await record.populate({
            path: 'employee',
            select: 'firstName lastName employeeId department',
            populate: { path: 'department', select: 'name' }
        });

        res.status(200).json({
            status: 'success',
            data: {
                ...record.toJSON(),
                config: {
                    monthlyQuotaMinutes: config.monthlyQuotaMinutes,
                    requireApproval: config.requireApproval
                }
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get monthly balance'
        });
    }
};

// Get all employees' monthly balances (Admin/Manager)
export const getAllMonthlyBalances = async (req, res) => {
    try {
        const { year, month, department, status } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

        const query = {
            year: targetYear,
            month: targetMonth
        };

        if (status) {
            query.status = status;
        }

        let records = await ShortLeaveRecord.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department designation profileImage',
                populate: { path: 'department', select: 'name' }
            })
            .sort({ 'employee.firstName': 1 });

        // Filter by department if specified
        if (department) {
            records = records.filter(r => r.employee?.department?._id?.toString() === department || r.employee?.department === department);
        }

        res.status(200).json({
            status: 'success',
            results: records.length,
            data: records
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get monthly balances'
        });
    }
};

// Initialize monthly balances for all active employees
export const initializeMonthlyBalances = async (req, res) => {
    try {
        const { year, month } = req.body;
        const targetYear = year || new Date().getFullYear();
        const targetMonth = month || new Date().getMonth() + 1;

        const config = await getOrCreateConfig();
        const employees = await Employee.find({ status: 'Active' });

        const results = {
            created: 0,
            alreadyExists: 0
        };

        for (const emp of employees) {
            const existing = await ShortLeaveRecord.findOne({
                employee: emp._id,
                year: targetYear,
                month: targetMonth
            });

            if (!existing) {
                await ShortLeaveRecord.create({
                    employee: emp._id,
                    year: targetYear,
                    month: targetMonth,
                    totalQuotaMinutes: config.monthlyQuotaMinutes,
                    status: 'Active'
                });
                results.created++;
            } else {
                results.alreadyExists++;
            }
        }

        res.status(200).json({
            status: 'success',
            message: `Initialized ${results.created} records (${results.alreadyExists} already existed)`,
            data: results
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to initialize monthly balances'
        });
    }
};

// ============ SHORT LEAVE ENTRIES ============

// Get all short leave entries with filters
export const getShortLeaveEntries = async (req, res) => {
    try {
        const { employee, startDate, endDate, status, type, department } = req.query;
        const query = {};

        if (employee) {
            query.employee = employee;
        }

        if (startDate && endDate) {
            query.date = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        } else if (startDate) {
            query.date = { $gte: new Date(startDate) };
        } else if (endDate) {
            query.date = { $lte: new Date(endDate) };
        }

        if (status) {
            query.status = status;
        }

        if (type) {
            query.type = type;
        }

        let entries = await ShortLeaveEntry.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department designation profileImage',
                populate: { path: 'department', select: 'name' }
            })
            .populate('approvedBy', 'name email')
            .populate('rejectedBy', 'name email')
            .populate('attendance')
            .sort({ date: -1, createdAt: -1 });

        // Filter by department if specified
        if (department) {
            entries = entries.filter(e => e.employee?.department?._id?.toString() === department || e.employee?.department === department);
        }

        res.status(200).json({
            status: 'success',
            results: entries.length,
            data: entries
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get short leave entries'
        });
    }
};

// Get current user's short leave entries
export const getMyShortLeaveEntries = async (req, res) => {
    try {
        const emp = await getEmployeeRecord(req.user);
        if (!emp) {
            return res.status(200).json({
                status: 'success',
                results: 0,
                data: []
            });
        }

        const { year, month, status } = req.query;
        const query = { employee: emp._id || emp };

        if (year && month) {
            const startDate = new Date(year, month - 1, 1);
            const endDate = new Date(year, month, 0);
            query.date = { $gte: startDate, $lte: endDate };
        }

        if (status) {
            query.status = status;
        }

        const entries = await ShortLeaveEntry.find(query)
            .populate('approvedBy', 'name email')
            .populate('rejectedBy', 'name email')
            .populate('attendance')
            .sort({ date: -1, createdAt: -1 });

        res.status(200).json({
            status: 'success',
            results: entries.length,
            data: entries
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get short leave entries'
        });
    }
};

// Create a manual short leave request
export const createShortLeaveEntry = async (req, res) => {
    try {
        const { date, minutesUsed, reason } = req.body;

        const emp = await getEmployeeRecord(req.user);
        if (!emp) {
            return res.status(400).json({
                status: 'error',
                message: 'Employee record not found'
            });
        }

        const entryDate = new Date(date);
        const year = entryDate.getFullYear();
        const month = entryDate.getMonth() + 1;

        const config = await getOrCreateConfig();
        const monthlyRecord = await getOrCreateMonthlyRecord(emp._id || emp, year, month, config.monthlyQuotaMinutes);

        // Check if quota would be exceeded
        const totalAfterRequest = monthlyRecord.usedMinutes + monthlyRecord.pendingMinutes + minutesUsed;

        const entry = await ShortLeaveEntry.create({
            employee: emp._id || emp,
            date: entryDate,
            type: 'Manual Request',
            minutesUsed,
            reason,
            status: config.requireApproval ? 'Pending' : 'Deducted',
            monthlyRecord: monthlyRecord._id
        });

        // Update pending minutes if approval required, otherwise deduct directly
        if (config.requireApproval) {
            monthlyRecord.pendingMinutes += minutesUsed;
        } else {
            monthlyRecord.usedMinutes += minutesUsed;
            if (monthlyRecord.usedMinutes >= monthlyRecord.totalQuotaMinutes) {
                monthlyRecord.status = 'Exhausted';
            }
        }
        await monthlyRecord.save();

        // Create history entry
        await createHistoryEntry(
            entry._id,
            emp._id || emp,
            'Created',
            null,
            entry.status,
            minutesUsed,
            req.user._id,
            reason
        );

        res.status(201).json({
            status: 'success',
            data: entry
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create short leave entry'
        });
    }
};

// ============ APPROVAL WORKFLOW ============

// Approve short leave entry (marks employee as Present, counts as used)
export const approveShortLeaveEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;

        // Require comment/remarks for approval
        if (!comment || !comment.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Remarks/comment is required for approval'
            });
        }

        const entry = await ShortLeaveEntry.findById(id);
        if (!entry) {
            return res.status(404).json({
                status: 'error',
                message: 'Short leave entry not found'
            });
        }

        if (entry.status !== 'Pending') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot approve entry with status: ${entry.status}`
            });
        }

        const previousStatus = entry.status;
        entry.status = 'Approved';
        entry.approvedBy = req.user._id;
        entry.approvedAt = new Date();
        entry.managerComment = comment.trim();
        await entry.save();

        // Update monthly record - move from pending to used AND approved
        const monthlyRecord = await ShortLeaveRecord.findById(entry.monthlyRecord);
        if (monthlyRecord) {
            monthlyRecord.pendingMinutes = Math.max(0, monthlyRecord.pendingMinutes - entry.minutesUsed);
            monthlyRecord.approvedMinutes += entry.minutesUsed;
            monthlyRecord.usedMinutes += entry.minutesUsed; // Also count as used
            await monthlyRecord.save();
        }


        // Update attendance to Present if exists
        if (entry.attendance) {
            await Attendance.findByIdAndUpdate(entry.attendance, {
                status: 'Present',
                notes: `Short leave approved by manager${comment ? ': ' + comment : ''}`
            });
        }

        // Create history entry
        await createHistoryEntry(
            entry._id,
            entry.employee,
            'Approved',
            previousStatus,
            'Approved',
            entry.minutesUsed,
            req.user._id,
            comment
        );

        // Notify employee
        try {
            await createNotification({
                recipient: entry.employee,
                type: 'leave',
                title: 'Short Leave Approved',
                message: `Your short leave request for ${entry.minutesUsed} minutes has been approved.`,
                relatedModel: 'ShortLeaveEntry',
                relatedId: entry._id
            });
        } catch (e) {
            console.error('Failed to send notification:', e);
        }

        await entry.populate('employee', 'firstName lastName employeeId');

        res.status(200).json({
            status: 'success',
            message: 'Short leave approved successfully',
            data: entry
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to approve short leave entry'
        });
    }
};

// Reject short leave entry
export const rejectShortLeaveEntry = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({
                status: 'error',
                message: 'Rejection reason is required'
            });
        }

        const entry = await ShortLeaveEntry.findById(id);
        if (!entry) {
            return res.status(404).json({
                status: 'error',
                message: 'Short leave entry not found'
            });
        }

        if (entry.status !== 'Pending') {
            return res.status(400).json({
                status: 'error',
                message: `Cannot reject entry with status: ${entry.status}`
            });
        }

        const previousStatus = entry.status;
        entry.status = 'Rejected';
        entry.rejectedBy = req.user._id;
        entry.rejectedAt = new Date();
        entry.rejectionReason = reason;
        await entry.save();

        // Update monthly record - remove from pending (NO deduction from quota on rejection)
        const monthlyRecord = await ShortLeaveRecord.findById(entry.monthlyRecord);
        if (monthlyRecord) {
            // Only remove from pending, do NOT add to usedMinutes
            // Rejected requests should not deduct from quota per business rules
            monthlyRecord.pendingMinutes = Math.max(0, monthlyRecord.pendingMinutes - entry.minutesUsed);
            await monthlyRecord.save();
        }

        // Update attendance to Half Day when short leave is rejected
        if (entry.attendance) {
            await Attendance.findByIdAndUpdate(entry.attendance, {
                status: 'Half Day',
                notes: `Short leave rejected by manager: ${reason}`
            });
        }

        // Create history entry
        await createHistoryEntry(
            entry._id,
            entry.employee,
            'Rejected',
            previousStatus,
            'Rejected',
            entry.minutesUsed,
            req.user._id,
            reason
        );

        // Notify employee
        try {
            await createNotification({
                recipient: entry.employee,
                type: 'leave',
                title: 'Short Leave Rejected',
                message: `Your short leave request has been rejected and your attendance is marked as Half Day. Reason: ${reason}`,
                relatedModel: 'ShortLeaveEntry',
                relatedId: entry._id
            });
        } catch (e) {
            console.error('Failed to send notification:', e);
        }

        res.status(200).json({
            status: 'success',
            message: 'Short leave rejected - Attendance marked as Half Day',
            data: entry
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to reject short leave entry'
        });
    }
};

// Approve half-day as Present (Manager override)
export const approveHalfDayAsPresent = async (req, res) => {
    try {
        const { attendanceId } = req.params;
        const { comment } = req.body;

        const attendance = await Attendance.findById(attendanceId);
        if (!attendance) {
            return res.status(404).json({
                status: 'error',
                message: 'Attendance record not found'
            });
        }

        if (attendance.status !== 'Half Day') {
            return res.status(400).json({
                status: 'error',
                message: 'This attendance is not marked as Half Day'
            });
        }

        const previousStatus = attendance.status;
        attendance.status = 'Present';
        attendance.notes = `Half Day overridden to Present by manager${comment ? ': ' + comment : ''}`;
        await attendance.save();

        // Find and update related short leave entry
        const entry = await ShortLeaveEntry.findOne({ attendance: attendanceId });
        if (entry) {
            entry.halfDayApprovedAsPresent = true;
            entry.halfDayApprovedBy = req.user._id;
            entry.halfDayApprovedAt = new Date();
            if (comment) entry.managerComment = comment;
            await entry.save();

            // Create history entry
            await createHistoryEntry(
                entry._id,
                entry.employee,
                'Half Day Approved as Present',
                'Converted to Half Day',
                'Present',
                entry.minutesUsed,
                req.user._id,
                comment
            );
        }

        await attendance.populate('employee', 'firstName lastName employeeId');

        res.status(200).json({
            status: 'success',
            message: 'Half day approved as Present successfully',
            data: attendance
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to approve half day as present'
        });
    }
};

// ============ ATTENDANCE INTEGRATION ============

// Process late arrival - called from attendanceController
export const processLateArrival = async (employeeId, checkInTime, attendanceId) => {
    try {
        const config = await getOrCreateConfig();
        if (!config.isActive || !config.autoDeductOnCheckIn) return null;

        const expectedStartTime = parseTimeToDate(config.workStartTime, checkInTime);
        const lateMinutes = Math.floor((checkInTime - expectedStartTime) / (1000 * 60));

        // Check if late beyond grace period
        if (lateMinutes <= config.graceMinutes) return null;

        const actualLateMinutes = lateMinutes - config.graceMinutes;
        const date = new Date(checkInTime);
        date.setHours(0, 0, 0, 0);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;

        const monthlyRecord = await getOrCreateMonthlyRecord(employeeId, year, month, config.monthlyQuotaMinutes);

        // Create short leave entry
        const entry = await ShortLeaveEntry.create({
            employee: employeeId,
            date,
            type: 'Late Arrival',
            minutesUsed: actualLateMinutes,
            reason: `Late arrival by ${actualLateMinutes} minutes`,
            status: config.requireApproval ? 'Pending' : 'Deducted',
            attendance: attendanceId,
            monthlyRecord: monthlyRecord._id,
            checkInTime,
            expectedTime: expectedStartTime
        });

        // Update monthly record
        if (config.requireApproval) {
            monthlyRecord.pendingMinutes += actualLateMinutes;
        } else {
            monthlyRecord.usedMinutes += actualLateMinutes;
        }

        // Check if quota exhausted and auto half-day conversion enabled
        const totalConsumed = monthlyRecord.usedMinutes + (config.requireApproval ? 0 : actualLateMinutes);
        if (config.autoHalfDayConversion && totalConsumed >= config.halfDayThresholdMinutes) {
            monthlyRecord.status = 'Exhausted';

            // Mark attendance as half day
            await Attendance.findByIdAndUpdate(attendanceId, { status: 'Half Day' });
            entry.status = 'Converted to Half Day';
            entry.convertedToHalfDay = true;
            monthlyRecord.halfDaysConverted += 1;
            await entry.save();

            // Create history for conversion
            await createHistoryEntry(
                entry._id,
                employeeId,
                'Converted to Half Day',
                'Pending',
                'Converted to Half Day',
                actualLateMinutes,
                null,
                'Automatic conversion due to quota exhaustion'
            );
        }

        await monthlyRecord.save();

        // Create initial history entry
        await createHistoryEntry(
            entry._id,
            employeeId,
            'Created',
            null,
            entry.status,
            actualLateMinutes,
            null,
            `Late arrival: ${actualLateMinutes} minutes`
        );

        return entry;
    } catch (error) {
        console.error('Error processing late arrival:', error);
        return null;
    }
};

// Process early departure - called from attendanceController
export const processEarlyDeparture = async (employeeId, checkOutTime, attendanceId) => {
    try {
        const config = await getOrCreateConfig();
        if (!config.isActive || !config.autoDeductOnCheckOut) return null;

        const expectedEndTime = parseTimeToDate(config.workEndTime, checkOutTime);
        const earlyMinutes = Math.floor((expectedEndTime - checkOutTime) / (1000 * 60));

        // Check if left early beyond grace period
        if (earlyMinutes <= config.graceMinutes) return null;

        const actualEarlyMinutes = earlyMinutes - config.graceMinutes;
        const date = new Date(checkOutTime);
        date.setHours(0, 0, 0, 0);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;

        const monthlyRecord = await getOrCreateMonthlyRecord(employeeId, year, month, config.monthlyQuotaMinutes);

        // Create short leave entry
        const entry = await ShortLeaveEntry.create({
            employee: employeeId,
            date,
            type: 'Early Departure',
            minutesUsed: actualEarlyMinutes,
            reason: `Early departure by ${actualEarlyMinutes} minutes`,
            status: config.requireApproval ? 'Pending' : 'Deducted',
            attendance: attendanceId,
            monthlyRecord: monthlyRecord._id,
            checkOutTime,
            expectedTime: expectedEndTime
        });

        // Update monthly record
        if (config.requireApproval) {
            monthlyRecord.pendingMinutes += actualEarlyMinutes;
        } else {
            monthlyRecord.usedMinutes += actualEarlyMinutes;
        }

        // Check if quota exhausted
        const totalConsumed = monthlyRecord.usedMinutes;
        if (config.autoHalfDayConversion && totalConsumed >= config.halfDayThresholdMinutes) {
            monthlyRecord.status = 'Exhausted';

            // Mark attendance as half day if not already
            const attendance = await Attendance.findById(attendanceId);
            if (attendance && attendance.status !== 'Half Day') {
                attendance.status = 'Half Day';
                await attendance.save();
                entry.status = 'Converted to Half Day';
                entry.convertedToHalfDay = true;
                monthlyRecord.halfDaysConverted += 1;
                await entry.save();
            }
        }

        await monthlyRecord.save();

        // Create history entry
        await createHistoryEntry(
            entry._id,
            employeeId,
            'Created',
            null,
            entry.status,
            actualEarlyMinutes,
            null,
            `Early departure: ${actualEarlyMinutes} minutes`
        );

        return entry;
    } catch (error) {
        console.error('Error processing early departure:', error);
        return null;
    }
};

// ============ HISTORY & STATS ============

// Get short leave history
export const getShortLeaveHistory = async (req, res) => {
    try {
        const { employee, startDate, endDate, action } = req.query;
        const query = {};

        if (employee) {
            query.employee = employee;
        } else if (req.user.role === 'employee') {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                query.employee = emp._id || emp;
            }
        }

        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
            };
        }

        if (action) {
            query.action = action;
        }

        const history = await ShortLeaveHistory.find(query)
            .populate('entry')
            .populate('employee', 'firstName lastName employeeId')
            .populate('performedBy', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            status: 'success',
            results: history.length,
            data: history
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get short leave history'
        });
    }
};

// Get short leave stats
export const getShortLeaveStats = async (req, res) => {
    try {
        const { year, month } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;

        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0);

        // Get employee count for role-based filtering
        let employeeFilter = {};
        if (req.user.role === 'employee') {
            const emp = await getEmployeeRecord(req.user);
            if (emp) {
                employeeFilter = { employee: emp._id || emp };
            }
        }

        const [
            totalRecords,
            exhaustedRecords,
            pendingEntries,
            approvedEntries,
            deductedEntries,
            halfDayConversions,
            totalMinutesUsed,
            totalMinutesPending
        ] = await Promise.all([
            ShortLeaveRecord.countDocuments({ year: targetYear, month: targetMonth, ...employeeFilter }),
            ShortLeaveRecord.countDocuments({ year: targetYear, month: targetMonth, status: 'Exhausted', ...employeeFilter }),
            ShortLeaveEntry.countDocuments({ date: { $gte: startDate, $lte: endDate }, status: 'Pending', ...employeeFilter }),
            ShortLeaveEntry.countDocuments({ date: { $gte: startDate, $lte: endDate }, status: 'Approved', ...employeeFilter }),
            ShortLeaveEntry.countDocuments({ date: { $gte: startDate, $lte: endDate }, status: 'Deducted', ...employeeFilter }),
            ShortLeaveEntry.countDocuments({ date: { $gte: startDate, $lte: endDate }, convertedToHalfDay: true, ...employeeFilter }),
            ShortLeaveRecord.aggregate([
                { $match: { year: targetYear, month: targetMonth, ...employeeFilter } },
                { $group: { _id: null, total: { $sum: '$usedMinutes' } } }
            ]),
            ShortLeaveRecord.aggregate([
                { $match: { year: targetYear, month: targetMonth, ...employeeFilter } },
                { $group: { _id: null, total: { $sum: '$pendingMinutes' } } }
            ])
        ]);

        res.status(200).json({
            status: 'success',
            data: {
                year: targetYear,
                month: targetMonth,
                totalEmployees: totalRecords,
                exhaustedQuota: exhaustedRecords,
                pendingApprovals: pendingEntries,
                approved: approvedEntries,
                deducted: deductedEntries,
                halfDayConversions,
                totalMinutesUsed: totalMinutesUsed[0]?.total || 0,
                totalMinutesPending: totalMinutesPending[0]?.total || 0
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get short leave stats'
        });
    }
};

// Get pending approvals count (for dashboard)
export const getPendingApprovalsCount = async (req, res) => {
    try {
        const count = await ShortLeaveEntry.countDocuments({ status: 'Pending' });

        res.status(200).json({
            status: 'success',
            data: { pendingCount: count }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get pending approvals count'
        });
    }
};

// ============ AUTO-REJECTION CRON JOB ============

// Auto-reject expired pending entries (called by scheduler at midnight)
export const autoRejectExpiredEntries = async () => {
    try {
        // At midnight, reject ALL pending entries from previous days
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const pendingEntries = await ShortLeaveEntry.find({
            status: 'Pending',
            date: { $lt: today }  // All pending entries with date before today
        });

        let rejectedCount = 0;

        for (const entry of pendingEntries) {
            entry.status = 'Rejected';
            entry.rejectedAt = new Date();
            entry.rejectionReason = 'Auto-rejected: 24-hour approval window expired';
            await entry.save();

            // Update monthly record - remove from pending
            const monthlyRecord = await ShortLeaveRecord.findById(entry.monthlyRecord);
            if (monthlyRecord) {
                monthlyRecord.pendingMinutes = Math.max(0, monthlyRecord.pendingMinutes - entry.minutesUsed);
                await monthlyRecord.save();
            }

            // Update attendance to Half Day
            if (entry.attendance) {
                await Attendance.findByIdAndUpdate(entry.attendance, {
                    status: 'Half Day',
                    notes: 'Short leave auto-rejected: 24-hour approval window expired'
                });
            }

            // Create history entry
            await createHistoryEntry(
                entry._id,
                entry.employee,
                'Rejected',
                'Pending',
                'Rejected',
                entry.minutesUsed,
                null,
                'Auto-rejected: 24-hour approval window expired'
            );

            // Send notification to employee
            try {
                await createNotification({
                    recipient: entry.employee,
                    type: 'leave',
                    title: 'Short Leave Auto-Rejected',
                    message: `Your short leave request for ${entry.minutesUsed} minutes has been auto-rejected (24-hour window expired). Attendance marked as Half Day.`,
                    relatedModel: 'ShortLeaveEntry',
                    relatedId: entry._id
                });
            } catch (e) {
                console.error('Failed to send auto-rejection notification:', e);
            }

            rejectedCount++;
        }

        console.log(`[AUTO-REJECT] Processed ${rejectedCount} expired short leave entries`);
        return { rejected: rejectedCount };
    } catch (error) {
        console.error('[AUTO-REJECT] Error:', error);
        throw error;
    }
};
