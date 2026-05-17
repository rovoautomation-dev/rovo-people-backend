import { LeaveType, LeaveRequest, LeaveBalance } from '../models/Leave.js';
import Employee from '../models/Employee.js';
import { Attendance, Holiday } from '../models/Attendance.js';
import {
    notifyManagersAboutLeave,
    notifyEmployeeAboutLeaveDecision
} from './notificationController.js';

// ============ LEAVE TYPES ============

// Get all leave types
export const getLeaveTypes = async (req, res) => {
    try {
        const leaveTypes = await LeaveType.find().sort({ name: 1 });
        res.status(200).json({
            status: 'success',
            results: leaveTypes.length,
            data: leaveTypes
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave types'
        });
    }
};

// Create leave type
export const createLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.create(req.body);
        res.status(201).json({
            status: 'success',
            data: leaveType
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create leave type'
        });
    }
};

// Update leave type
export const updateLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!leaveType) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave type not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: leaveType
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update leave type'
        });
    }
};

// Delete leave type
export const deleteLeaveType = async (req, res) => {
    try {
        const leaveType = await LeaveType.findByIdAndDelete(req.params.id);

        if (!leaveType) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave type not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete leave type'
        });
    }
};

// ============ LEAVE REQUESTS ============

// Get all leave requests
// Get current user's leave requests
export const getMyLeaveRequests = async (req, res) => {
    try {
        const { status, startDate, endDate } = req.query;
        // Always force filter by logged-in user's employee ID
        const employeeData = req.user.employee;
        const employeeId = employeeData?._id || employeeData;

        if (!employeeId) {
            return res.status(200).json({
                status: 'success',
                results: 0,
                data: []
            });
        }

        const query = { employee: employeeId };

        if (status) query.status = status;
        if (startDate && endDate) {
            query.startDate = { $gte: new Date(startDate) };
            query.endDate = { $lte: new Date(endDate) };
        }

        const leaveRequests = await LeaveRequest.find(query)
            .populate('employee', 'firstName lastName employeeId department designation profileImage')
            .populate('leaveType', 'name')
            .populate('approvedBy', 'email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            status: 'success',
            results: leaveRequests.length,
            data: leaveRequests
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave requests'
        });
    }
};

// Get all leave requests (Admin/Manager view)
export const getLeaveRequests = async (req, res) => {
    try {
        const { status, employee, startDate, endDate } = req.query;
        const query = {};

        // If user is basic employee, force filter by their employee ID (Legacy safety, preferred to use getMyLeaveRequests)
        if (req.user.role === 'employee') {
            query.employee = req.user.employee;
        } else if (req.user.role === 'manager') {
            // Manager: Show only leaves of employees reporting to this manager
            // Note: We need to find all employees who have this manager as reportingManager
            const reportees = await Employee.find({ reportingManager: req.user.employee }).select('_id');
            const reporteeIds = reportees.map(e => e._id);

            // If filtering by specific employee, check if they are in reportees
            if (employee) {
                if (reporteeIds.some(id => id.toString() === employee)) {
                    query.employee = employee;
                } else {
                    // If trying to access unauthorized employee, return empty
                    query.employee = null;
                }
            } else {
                query.employee = { $in: reporteeIds };
            }
        } else if (employee) {
            // Admin can filter by specific employee
            query.employee = employee;
        }

        if (status) query.status = status;
        if (startDate && endDate) {
            query.startDate = { $gte: new Date(startDate) };
            query.endDate = { $lte: new Date(endDate) };
        }

        const leaveRequests = await LeaveRequest.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department designation profileImage',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            })
            .populate('leaveType', 'name')
            .populate('approvedBy', 'email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            status: 'success',
            results: leaveRequests.length,
            data: leaveRequests
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave requests'
        });
    }
};

// Get leave request by ID
export const getLeaveRequest = async (req, res) => {
    try {
        const leaveRequest = await LeaveRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName employeeId department designation profileImage')
            .populate('leaveType', 'name')
            .populate('approvedBy', 'email');

        if (!leaveRequest) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave request not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: leaveRequest
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave request'
        });
    }
};

// Create leave request
export const createLeaveRequest = async (req, res) => {
    try {
        console.log('Creating leave request:', req.body);
        console.log('User:', req.user);

        // If employee is creating the request, ensure it's for themselves
        // Extract ID from populated employee object
        if (req.user.role === 'employee') {
            const employeeData = req.user.employee;
            req.body.employee = employeeData._id ? employeeData._id : employeeData;
        }

        const { leaveType, startDate, endDate } = req.body;
        const employee = req.body.employee;
        console.log('Extracted data:', { employee, leaveType, startDate, endDate });

        if (!employee) {
            return res.status(400).json({
                status: 'error',
                message: 'Employee ID is required'
            });
        }

        // Check for overlapping leave requests
        const overlapping = await LeaveRequest.findOne({
            employee,
            status: { $in: ['Pending', 'Approved'] },
            $or: [
                { startDate: { $lte: new Date(endDate) }, endDate: { $gte: new Date(startDate) } }
            ]
        });

        if (overlapping) {
            return res.status(400).json({
                status: 'error',
                message: 'You already have a leave request for this period'
            });
        }

        // Calculate total days
        let totalDays;
        if (req.body.isHalfDay) {
            totalDays = 0.5;
        } else {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const diffTime = Math.abs(end - start);
            totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
        }
        req.body.totalDays = totalDays;

        // Check leave balance
        const year = new Date(startDate).getFullYear();
        const balance = await LeaveBalance.findOne({ employee, leaveType, year });

        if (balance && balance.available < totalDays) {
            return res.status(400).json({
                status: 'error',
                message: `Insufficient leave balance. You have ${balance.available} days remaining.`
            });
        }

        // Validate no Sundays (non-working days) in leave range
        const start = new Date(startDate);
        const end = new Date(endDate);
        let current = new Date(start);
        while (current <= end) {
            if (current.getDay() === 0) { // Sunday
                return res.status(400).json({
                    status: 'error',
                    message: 'Cannot apply leave on Sundays (non-working day). Working days are Monday to Saturday.'
                });
            }
            current.setDate(current.getDate() + 1);
        }

        // Check for holidays in date range
        const holidays = await Holiday.find({
            date: { $gte: start, $lte: end }
        });
        if (holidays.length > 0) {
            const holidayNames = holidays.map(h => h.name).join(', ');
            return res.status(400).json({
                status: 'error',
                message: `Cannot apply leave on holidays: ${holidayNames}`
            });
        }

        const leaveRequest = await LeaveRequest.create(req.body);

        // Update pending balance
        if (balance) {
            balance.pending += leaveRequest.totalDays;
            await balance.save();
        }

        const populatedRequest = await LeaveRequest.findById(leaveRequest._id)
            .populate('employee', 'firstName lastName employeeId department designation')
            .populate('leaveType', 'name');

        // Notify managers about the new leave request
        try {
            await notifyManagersAboutLeave(populatedRequest, populatedRequest.employee, req.user._id);
        } catch (notifyError) {
            console.error('Failed to send notifications:', notifyError);
            // Don't fail the request if notifications fail
        }

        res.status(201).json({
            status: 'success',
            data: populatedRequest
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create leave request'
        });
    }
};

// Approve leave request
export const approveLeaveRequest = async (req, res) => {
    try {
        const leaveRequest = await LeaveRequest.findById(req.params.id);

        if (!leaveRequest) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave request not found'
            });
        }

        if (leaveRequest.status !== 'Pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending requests can be approved'
            });
        }

        leaveRequest.status = 'Approved';
        leaveRequest.approvedBy = req.user._id;
        leaveRequest.approvedAt = new Date();
        await leaveRequest.save();

        // Update leave balance
        const year = new Date(leaveRequest.startDate).getFullYear();
        const balance = await LeaveBalance.findOne({
            employee: leaveRequest.employee,
            leaveType: leaveRequest.leaveType,
            year
        });

        if (balance) {
            balance.pending -= leaveRequest.totalDays;
            balance.used += leaveRequest.totalDays;
            await balance.save();
        }

        const updatedRequest = await LeaveRequest.findById(leaveRequest._id)
            .populate('employee', 'firstName lastName employeeId department designation')
            .populate('leaveType', 'name')
            .populate('approvedBy', 'email');

        // Create attendance records for each leave day
        try {
            const startDate = new Date(leaveRequest.startDate);
            const endDate = new Date(leaveRequest.endDate);
            const currentDate = new Date(startDate);

            while (currentDate <= endDate) {
                const dateOnly = new Date(currentDate);
                dateOnly.setHours(0, 0, 0, 0);

                // Create or update attendance record
                await Attendance.findOneAndUpdate(
                    { employee: leaveRequest.employee, date: dateOnly },
                    {
                        employee: leaveRequest.employee,
                        date: dateOnly,
                        status: 'On Leave',
                        notes: `Leave: ${updatedRequest.leaveType?.name || 'Approved Leave'}`
                    },
                    { upsert: true, new: true }
                );
                currentDate.setDate(currentDate.getDate() + 1);
            }
        } catch (attendanceError) {
            console.error('Failed to create attendance records:', attendanceError);
            // Don't fail the approval if attendance update fails
        }

        // Notify employee about the approval
        try {
            await notifyEmployeeAboutLeaveDecision(updatedRequest, updatedRequest.employee, 'approved');
        } catch (notifyError) {
            console.error('Failed to send approval notification:', notifyError);
        }

        res.status(200).json({
            status: 'success',
            data: updatedRequest
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to approve leave request'
        });
    }
};

// Reject leave request
export const rejectLeaveRequest = async (req, res) => {
    try {
        const { rejectionReason } = req.body;
        const leaveRequest = await LeaveRequest.findById(req.params.id);

        if (!leaveRequest) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave request not found'
            });
        }

        if (leaveRequest.status !== 'Pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending requests can be rejected'
            });
        }

        leaveRequest.status = 'Rejected';
        leaveRequest.approvedBy = req.user._id;
        leaveRequest.approvedAt = new Date();
        leaveRequest.rejectionReason = rejectionReason;
        await leaveRequest.save();

        // Update leave balance
        const year = new Date(leaveRequest.startDate).getFullYear();
        const balance = await LeaveBalance.findOne({
            employee: leaveRequest.employee,
            leaveType: leaveRequest.leaveType,
            year
        });

        if (balance) {
            balance.pending -= leaveRequest.totalDays;
            await balance.save();
        }

        const updatedRequest = await LeaveRequest.findById(leaveRequest._id)
            .populate('employee', 'firstName lastName employeeId department designation')
            .populate('leaveType', 'name');

        // Notify employee about the rejection
        try {
            await notifyEmployeeAboutLeaveDecision(updatedRequest, updatedRequest.employee, 'rejected', rejectionReason);
        } catch (notifyError) {
            console.error('Failed to send rejection notification:', notifyError);
        }

        res.status(200).json({
            status: 'success',
            data: updatedRequest
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to reject leave request'
        });
    }
};

// Cancel leave request
export const cancelLeaveRequest = async (req, res) => {
    try {
        const leaveRequest = await LeaveRequest.findById(req.params.id);

        if (!leaveRequest) {
            return res.status(404).json({
                status: 'error',
                message: 'Leave request not found'
            });
        }

        if (leaveRequest.status === 'Cancelled') {
            return res.status(400).json({
                status: 'error',
                message: 'Leave request is already cancelled'
            });
        }

        const previousStatus = leaveRequest.status;
        leaveRequest.status = 'Cancelled';
        await leaveRequest.save();

        // Update leave balance
        const year = new Date(leaveRequest.startDate).getFullYear();
        const balance = await LeaveBalance.findOne({
            employee: leaveRequest.employee,
            leaveType: leaveRequest.leaveType,
            year
        });

        if (balance) {
            if (previousStatus === 'Pending') {
                balance.pending -= leaveRequest.totalDays;
            } else if (previousStatus === 'Approved') {
                balance.used -= leaveRequest.totalDays;
            }
            await balance.save();
        }

        res.status(200).json({
            status: 'success',
            data: leaveRequest
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to cancel leave request'
        });
    }
};

// ============ LEAVE BALANCES ============

// Get leave balances for an employee
export const getLeaveBalances = async (req, res) => {
    try {
        const { employee, year } = req.query;
        const currentYear = year ? parseInt(year) : new Date().getFullYear();
        const query = { year: currentYear };

        // Determine which employee to query
        let targetEmployeeId;
        if (req.user.role === 'employee') {
            targetEmployeeId = req.user.employee._id || req.user.employee;
        } else if (req.user.role === 'manager') {
            // Managers can only see their own leave balances on this endpoint
            targetEmployeeId = req.user.employee._id || req.user.employee;
        } else if (employee) {
            // Admin can filter by any employee
            targetEmployeeId = employee;
        }

        if (!targetEmployeeId) {
            return res.status(200).json({
                status: 'success',
                results: 0,
                data: []
            });
        }

        query.employee = targetEmployeeId;

        let balances = await LeaveBalance.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            })
            .populate('leaveType', 'name daysAllowed')
            .sort({ 'leaveType.name': 1 });

        // AUTO-CREATE: If employee has no balances, create them based on global policy
        if (balances.length === 0 && targetEmployeeId) {
            const leaveTypes = await LeaveType.find({ isActive: true });

            for (const type of leaveTypes) {
                try {
                    // Calculate used and pending days from existing requests
                    const usedRequests = await LeaveRequest.find({
                        employee: targetEmployeeId,
                        leaveType: type._id,
                        status: 'Approved',
                        startDate: { $gte: new Date(currentYear, 0, 1), $lte: new Date(currentYear, 11, 31) }
                    });
                    const pendingRequests = await LeaveRequest.find({
                        employee: targetEmployeeId,
                        leaveType: type._id,
                        status: 'Pending',
                        startDate: { $gte: new Date(currentYear, 0, 1), $lte: new Date(currentYear, 11, 31) }
                    });

                    const usedDays = usedRequests.reduce((acc, req) => acc + req.totalDays, 0);
                    const pendingDays = pendingRequests.reduce((acc, req) => acc + req.totalDays, 0);

                    await LeaveBalance.create({
                        employee: targetEmployeeId,
                        leaveType: type._id,
                        year: currentYear,
                        totalAllowed: type.daysAllowed,
                        used: usedDays,
                        pending: pendingDays,
                        carryForward: 0
                    });
                } catch (createErr) {
                    // Ignore duplicate key errors (balance already exists)
                    if (createErr.code !== 11000) {
                        console.error('Failed to auto-create balance:', createErr);
                    }
                }
            }

            // Re-fetch balances after creation
            balances = await LeaveBalance.find(query)
                .populate('employee', 'firstName lastName employeeId')
                .populate('leaveType', 'name daysAllowed')
                .sort({ 'leaveType.name': 1 });
        }

        res.status(200).json({
            status: 'success',
            results: balances.length,
            data: balances
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave balances'
        });
    }
};

// Initialize leave balances for a year
export const initializeLeaveBalances = async (req, res) => {
    try {
        const { year } = req.body;
        const employees = await Employee.find({ status: 'Active' });
        const leaveTypes = await LeaveType.find({ isActive: true });

        const balances = [];
        for (const employee of employees) {
            for (const leaveType of leaveTypes) {
                // Check if balance already exists
                const existing = await LeaveBalance.findOne({
                    employee: employee._id,
                    leaveType: leaveType._id,
                    year
                });

                if (!existing) {
                    // Get previous year balance for carry forward
                    const prevBalance = await LeaveBalance.findOne({
                        employee: employee._id,
                        leaveType: leaveType._id,
                        year: year - 1
                    });

                    let carryForward = 0;
                    if (leaveType.carryForward && prevBalance) {
                        carryForward = Math.min(
                            prevBalance.available,
                            leaveType.maxCarryForward
                        );
                    }

                    const newBalance = await LeaveBalance.create({
                        employee: employee._id,
                        leaveType: leaveType._id,
                        year,
                        totalAllowed: leaveType.daysAllowed,
                        carryForward
                    });
                    balances.push(newBalance);
                }
            }
        }

        res.status(201).json({
            status: 'success',
            message: `Initialized ${balances.length} leave balances for year ${year}`,
            data: balances
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to initialize leave balances'
        });
    }
};

// Get leave summary/stats
export const getLeaveStats = async (req, res) => {
    try {
        const query = {};

        // Apply role-based filtering (same as getLeaveRequests)
        if (req.user.role === 'employee') {
            query.employee = req.user.employee._id || req.user.employee;
        } else if (req.user.role === 'manager') {
            // Manager: Show only stats for employees reporting to this manager
            const reportees = await Employee.find({ reportingManager: req.user.employee }).select('_id');
            const reporteeIds = reportees.map(e => e._id);
            query.employee = { $in: reporteeIds };
        }
        // Admin has no filter, sees all

        const pendingCount = await LeaveRequest.countDocuments({ ...query, status: 'Pending' });
        const approvedCount = await LeaveRequest.countDocuments({ ...query, status: 'Approved' });
        const rejectedCount = await LeaveRequest.countDocuments({ ...query, status: 'Rejected' });

        const recentRequests = await LeaveRequest.find(query)
            .populate('employee', 'firstName lastName employeeId department profileImage')
            .populate('leaveType', 'name')
            .sort({ createdAt: -1 })
            .limit(5);

        res.status(200).json({
            status: 'success',
            data: {
                pending: pendingCount,
                approved: approvedCount,
                rejected: rejectedCount,
                total: pendingCount + approvedCount + rejectedCount,
                recentRequests
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get leave stats'
        });
    }
};
