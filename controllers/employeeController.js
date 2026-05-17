import Employee from '../models/Employee.js';
import Document from '../models/Document.js';
import User from '../models/User.js';
import { cloudinary } from '../config/cloudinary.js';

// @desc    Get all employees
// @route   GET /api/employees
import { Department } from '../models/Organization.js';
import { LeaveType, LeaveBalance } from '../models/Leave.js';

// @desc    Get all employees
// @route   GET /api/employees
export const getEmployees = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            search = '',
            department = '',
            status = '',
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build query
        const query = {};

        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { employeeId: { $regex: search, $options: 'i' } }
            ];
        }

        if (department) {
            query.department = department;
        }

        if (status) {
            query.status = status;
        }

        // Execute query with pagination
        const employees = await Employee.find(query)
            .populate('department', 'name code')
            .populate('reportingManager', 'firstName lastName')
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .select('-documents');

        const total = await Employee.countDocuments(query);

        // Get department stats (aggregation needs adjustment for ObjectId)
        // For now, simple count by department ID
        const departmentStats = await Employee.aggregate([
            { $group: { _id: '$department', count: { $sum: 1 } } }
        ]);

        // Get status stats
        const statusStats = await Employee.aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            data: employees,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalEmployees: total,
                hasMore: page * limit < total
            },
            stats: {
                departments: departmentStats,
                statuses: statusStats
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single employee
// @route   GET /api/employees/:id
export const getEmployee = async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id)
            .populate('documents')
            .populate('department', 'name code parentDepartment head')
            .populate('reportingManager', 'firstName lastName employeeId');

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        res.json({ success: true, data: employee });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Create employee
// @route   POST /api/employees
export const createEmployee = async (req, res) => {
    try {
        // Parse JSON strings in req.body (for multipart/form-data)
        ['address', 'emergencyContact'].forEach(field => {
            if (typeof req.body[field] === 'string') {
                try {
                    req.body[field] = JSON.parse(req.body[field]);
                } catch (e) {
                    console.error(`Failed to parse ${field}:`, e);
                }
            }
        });

        // Auto-assign reporting manager if not provided
        if (!req.body.reportingManager && req.body.department) {
            const department = await Department.findById(req.body.department);
            if (department && department.head) {
                // If the new employee is NOT the head, assign head as manager
                req.body.reportingManager = department.head;
            }
        }

        const employee = new Employee(req.body);

        // Handle profile image if uploaded
        if (req.file) {
            employee.profileImage = {
                url: req.file.path,
                publicId: req.file.filename
            };
        }

        await employee.save();

        // Auto-allocate leave balances for the current year based on Global Policy
        try {
            const currentYear = new Date().getFullYear();
            const leaveTypes = await LeaveType.find({ isActive: true });

            const balancePromises = leaveTypes.map(type => {
                return LeaveBalance.create({
                    employee: employee._id,
                    leaveType: type._id,
                    year: currentYear,
                    totalAllowed: type.daysAllowed, // Apply Global Policy
                    carryForward: 0
                });
            });

            await Promise.all(balancePromises);
            console.log(`Initialized ${balancePromises.length} leave balances for new employee ${employee._id}`);
        } catch (balanceError) {
            console.error('Failed to initialize leave balances:', balanceError);
            // Don't fail the request, just log it. Admin can run "Refresh Balances" later.
        }

        res.status(201).json({ success: true, data: employee });
    } catch (error) {
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern || {})[0];
            if (field === 'email') {
                const existingEmployee = await Employee.findOne({ email: req.body.email || error.keyValue?.email }).select('_id');
                return res.status(400).json({
                    success: false,
                    message: 'Email already exists',
                    existingId: existingEmployee?._id
                });
            }
            return res.status(400).json({ success: false, message: `${field || 'Field'} already exists` });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update employee
// @route   PUT /api/employees/:id
export const updateEmployee = async (req, res) => {
    try {
        // Parse JSON strings in req.body (for multipart/form-data)
        ['address', 'emergencyContact'].forEach(field => {
            if (typeof req.body[field] === 'string') {
                try {
                    req.body[field] = JSON.parse(req.body[field]);
                } catch (e) {
                    console.error(`Failed to parse ${field}:`, e);
                }
            }
        });

        const employee = await Employee.findById(req.params.id);

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        // Auto-assign reporting manager if department changed and manager not explicitly set
        if (req.body.department && req.body.department !== employee.department?.toString()) {
            if (!req.body.reportingManager) {
                const department = await Department.findById(req.body.department);
                if (department && department.head && department.head.toString() !== employee._id.toString()) {
                    req.body.reportingManager = department.head;
                }
            }
        }

        // Handle profile image update
        if (req.file) {
            // Delete old image from Cloudinary if exists
            if (employee.profileImage?.publicId) {
                await cloudinary.uploader.destroy(employee.profileImage.publicId);
            }
            req.body.profileImage = {
                url: req.file.path,
                publicId: req.file.filename
            };
        }

        const updatedEmployee = await Employee.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        )
            .populate('department', 'name code')
            .populate('reportingManager', 'firstName lastName');

        res.json({ success: true, data: updatedEmployee });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Email already exists' });
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete employee
// @route   DELETE /api/employees/:id
export const deleteEmployee = async (req, res) => {
    try {
        const employee = await Employee.findById(req.params.id).populate('documents');

        if (!employee) {
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        // Delete profile image from Cloudinary
        if (employee.profileImage?.publicId) {
            await cloudinary.uploader.destroy(employee.profileImage.publicId);
        }

        // Delete all documents from Cloudinary
        for (const doc of employee.documents) {
            await cloudinary.uploader.destroy(doc.publicId, { resource_type: 'raw' });
        }

        // Delete document records
        await Document.deleteMany({ employee: employee._id });

        // Delete linked User account (cascading deletion)
        // This invalidates all sessions for the deleted employee
        const linkedUser = await User.findOne({ employee: employee._id });
        if (linkedUser) {
            await linkedUser.invalidateAllSessions();
            await User.findByIdAndDelete(linkedUser._id);
            console.log(`Deleted linked User account for employee ${employee._id}`);
        }

        // Delete employee
        await Employee.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'Employee deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get dashboard stats
// @route   GET /api/employees/stats
export const getDashboardStats = async (req, res) => {
    try {
        const totalEmployees = await Employee.countDocuments();
        const activeEmployees = await Employee.countDocuments({ status: 'Active' });
        const onLeave = await Employee.countDocuments({ status: 'On Leave' });

        const departmentStats = await Employee.aggregate([
            { $group: { _id: '$department', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // Manually populate department names to handle mixed data (Ids vs Strings)
        const departments = await Department.find({}).select('name');
        const deptMap = {};
        departments.forEach(d => {
            deptMap[d._id.toString()] = d.name;
        });

        // Map stats to names
        const formattedDepartmentStats = departmentStats.map(stat => {
            let name = 'Unknown';
            if (stat._id) {
                // If it's a valid ObjectId in our map
                if (deptMap[stat._id.toString()]) {
                    name = deptMap[stat._id.toString()];
                } else {
                    // It might be a legacy string like "Engineering"
                    name = stat._id.toString();
                }
            } else {
                name = 'Unassigned';
            }
            return { name, count: stat.count };
        });

        const employmentTypeStats = await Employee.aggregate([
            { $group: { _id: '$employmentType', count: { $sum: 1 } } }
        ]);

        const recentEmployees = await Employee.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('firstName lastName department designation profileImage createdAt')
            .populate('department', 'name');

        // Monthly joining trends (last 6 months)
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const monthlyJoins = await Employee.aggregate([
            { $match: { dateOfJoining: { $gte: sixMonthsAgo } } },
            {
                $group: {
                    _id: {
                        year: { $year: '$dateOfJoining' },
                        month: { $month: '$dateOfJoining' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } }
        ]);

        res.json({
            success: true,
            data: {
                totalEmployees,
                activeEmployees,
                onLeave,
                inactiveEmployees: totalEmployees - activeEmployees - onLeave,
                departmentStats: formattedDepartmentStats,
                employmentTypeStats,
                recentEmployees,
                monthlyJoins
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all departments (from Department model now)
// @route   GET /api/employees/departments
export const getDepartments = async (req, res) => {
    try {
        // Fetch from Department model instead of distinct string values
        const departments = await Department.find({ isActive: true }).select('name code head parentDepartment');
        res.json({ success: true, data: departments });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
