import { Department, Announcement, Settings } from '../models/Organization.js';
import Employee from '../models/Employee.js';

// ============ DEPARTMENTS ============

// Get all departments
export const getDepartments = async (req, res) => {
    try {
        const departments = await Department.find()
            .populate('head', 'firstName lastName employeeId designation profileImage')
            .populate('parentDepartment', 'name')
            .sort({ name: 1 });

        // Get employee counts
        const deptWithCounts = await Promise.all(
            departments.map(async (dept) => {
                // Use native collection count to avoid Mongoose CastErrors with legacy string data
                const count = await Employee.collection.countDocuments({
                    $or: [
                        { department: dept._id },
                        { department: dept.name } // This is safe in native query
                    ],
                    status: 'Active'
                });
                return {
                    ...dept.toObject(),
                    employeeCount: count
                };
            })
        );

        res.status(200).json({
            status: 'success',
            results: deptWithCounts.length,
            data: deptWithCounts
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get departments'
        });
    }
};

// Get department by ID
export const getDepartment = async (req, res) => {
    try {
        const department = await Department.findById(req.params.id)
            .populate('head', 'firstName lastName employeeId designation profileImage email phone')
            .populate('parentDepartment', 'name');

        if (!department) {
            return res.status(404).json({
                status: 'error',
                message: 'Department not found'
            });
        }

        const employees = await Employee.find({
            department: department._id, // Only query by ID to safe-guard against CastError
            status: 'Active'
        }).select('firstName lastName employeeId designation profileImage');

        res.status(200).json({
            status: 'success',
            data: {
                ...department.toObject(),
                employees
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get department'
        });
    }
};

// Create department
export const createDepartment = async (req, res) => {
    try {
        // Clean empty ObjectId fields
        const data = { ...req.body };
        if (data.parentDepartment === '' || data.parentDepartment === null) {
            delete data.parentDepartment;
        }
        if (data.head === '' || data.head === null) {
            delete data.head;
        }

        const department = await Department.create(data);

        const populated = await Department.findById(department._id)
            .populate('head', 'firstName lastName employeeId designation')
            .populate('parentDepartment', 'name');

        res.status(201).json({
            status: 'success',
            data: populated
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create department'
        });
    }
};

// Update department
export const updateDepartment = async (req, res) => {
    try {
        // Clean empty ObjectId fields
        const data = { ...req.body };
        if (data.parentDepartment === '' || data.parentDepartment === null) {
            data.parentDepartment = null;
        }
        if (data.head === '' || data.head === null) {
            data.head = null;
        }

        const department = await Department.findByIdAndUpdate(
            req.params.id,
            data,
            { new: true, runValidators: true }
        )
            .populate('head', 'firstName lastName employeeId designation')
            .populate('parentDepartment', 'name');

        if (!department) {
            return res.status(404).json({
                status: 'error',
                message: 'Department not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: department
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update department'
        });
    }
};

// Delete department
export const deleteDepartment = async (req, res) => {
    try {
        // Check if department has employees
        const dept = await Department.findById(req.params.id);
        if (!dept) {
            return res.status(404).json({
                status: 'error',
                message: 'Department not found'
            });
        }

        const employeeCount = await Employee.collection.countDocuments({
            $or: [
                { department: dept._id },
                { department: dept.name }
            ]
        });
        if (employeeCount > 0) {
            return res.status(400).json({
                status: 'error',
                message: `Cannot delete department with ${employeeCount} employees. Please reassign employees first.`
            });
        }

        await dept.deleteOne();

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete department'
        });
    }
};

// Get organization structure (hierarchy)
export const getOrgStructure = async (req, res) => {
    try {
        const departments = await Department.find({ isActive: true })
            .populate('head', 'firstName lastName employeeId designation profileImage')
            .populate('parentDepartment', 'name')
            .sort({ name: 1 });

        // Build hierarchy
        const deptMap = {};
        const rootDepts = [];

        // First pass: create map
        for (const dept of departments) {
            const deptObj = dept.toObject();
            deptObj.children = [];
            deptObj.employeeCount = await Employee.collection.countDocuments({
                $or: [
                    { department: dept._id },
                    { department: dept.name }
                ],
                status: 'Active'
            });
            deptMap[dept._id.toString()] = deptObj;
        }

        // Second pass: build tree
        for (const dept of departments) {
            const deptObj = deptMap[dept._id.toString()];
            if (dept.parentDepartment) {
                const parent = deptMap[dept.parentDepartment._id.toString()];
                if (parent) {
                    parent.children.push(deptObj);
                } else {
                    rootDepts.push(deptObj);
                }
            } else {
                rootDepts.push(deptObj);
            }
        }

        res.status(200).json({
            status: 'success',
            data: rootDepts
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get organization structure'
        });
    }
};

// ============ ANNOUNCEMENTS ============

// Get announcements
export const getAnnouncements = async (req, res) => {
    try {
        const { priority, type, active } = req.query;
        const query = {};

        if (priority) query.priority = priority;
        if (type) query.type = type;
        if (active !== undefined) {
            query.isActive = active === 'true';
            query.startDate = { $lte: new Date() };
            query.$or = [
                { endDate: null },
                { endDate: { $gte: new Date() } }
            ];
        }

        const announcements = await Announcement.find(query)
            .populate('createdBy', 'email')
            .populate('departments', 'name')
            .sort({ isPinned: -1, createdAt: -1 });

        res.status(200).json({
            status: 'success',
            results: announcements.length,
            data: announcements
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get announcements'
        });
    }
};

// Get announcement by ID
export const getAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id)
            .populate('createdBy', 'email')
            .populate('departments', 'name');

        if (!announcement) {
            return res.status(404).json({
                status: 'error',
                message: 'Announcement not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: announcement
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get announcement'
        });
    }
};

// Create announcement
export const createAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.create({
            ...req.body,
            createdBy: req.user._id
        });

        const populated = await Announcement.findById(announcement._id)
            .populate('createdBy', 'email')
            .populate('departments', 'name');

        res.status(201).json({
            status: 'success',
            data: populated
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create announcement'
        });
    }
};

// Update announcement
export const updateAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        )
            .populate('createdBy', 'email')
            .populate('departments', 'name');

        if (!announcement) {
            return res.status(404).json({
                status: 'error',
                message: 'Announcement not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: announcement
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update announcement'
        });
    }
};

// Delete announcement
export const deleteAnnouncement = async (req, res) => {
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);

        if (!announcement) {
            return res.status(404).json({
                status: 'error',
                message: 'Announcement not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete announcement'
        });
    }
};

// ============ SETTINGS ============

// Get settings by category
export const getSettings = async (req, res) => {
    try {
        const { category } = req.params;
        const settings = await Settings.findOne({ category });

        if (!settings) {
            return res.status(200).json({
                status: 'success',
                data: { category, settings: {} }
            });
        }

        res.status(200).json({
            status: 'success',
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get settings'
        });
    }
};

// Get all settings
export const getAllSettings = async (req, res) => {
    try {
        const settings = await Settings.find().populate('updatedBy', 'email');

        res.status(200).json({
            status: 'success',
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get settings'
        });
    }
};

// Update settings
export const updateSettings = async (req, res) => {
    try {
        const { category } = req.params;
        const { settings: newSettings } = req.body;

        const settings = await Settings.findOneAndUpdate(
            { category },
            {
                settings: newSettings,
                updatedBy: req.user._id
            },
            { new: true, upsert: true, runValidators: true }
        );

        res.status(200).json({
            status: 'success',
            data: settings
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update settings'
        });
    }
};
