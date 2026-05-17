import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Employee from '../models/Employee.js';

// Generate JWT token
const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'hr-crm-secret-key-2026', {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

// Create and send token response
const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);

    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
            user
        }
    });
};

// Register new user
export const register = async (req, res) => {
    try {
        const { email, password, role, employeeId } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                status: 'error',
                message: 'User with this email already exists'
            });
        }

        // If employeeId provided, verify employee exists
        let employee = null;
        if (employeeId) {
            employee = await Employee.findById(employeeId);
            if (!employee) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Employee not found'
                });
            }
        }

        // Create new user
        const newUser = await User.create({
            email,
            password,
            role: role || 'employee',
            employee: employee?._id
        });

        createSendToken(newUser, 201, res);
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to register user'
        });
    }
};

// Login user
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if email and password exist
        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Please provide email and password'
            });
        }

        // Check if user exists and password is correct
        const user = await User.findOne({ email }).select('+password').populate('employee');

        if (!user || !(await user.correctPassword(password, user.password))) {
            return res.status(401).json({
                status: 'error',
                message: 'Incorrect email or password'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                status: 'error',
                message: 'Your account has been deactivated. Please contact admin.'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        createSendToken(user, 200, res);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to login'
        });
    }
};

// Protect routes - middleware
export const protect = async (req, res, next) => {
    try {
        let token;

        // Get token from header
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({
                status: 'error',
                message: 'You are not logged in. Please log in to get access.'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'hr-crm-secret-key-2026');

        // Check if user still exists
        const currentUser = await User.findById(decoded.id).populate('employee');
        if (!currentUser) {
            return res.status(401).json({
                status: 'error',
                message: 'The user belonging to this token no longer exists.'
            });
        }

        // Check if user changed password after the token was issued
        if (currentUser.changedPasswordAfter(decoded.iat)) {
            return res.status(401).json({
                status: 'error',
                message: 'User recently changed password. Please log in again.'
            });
        }

        // Check if token was invalidated (session terminated)
        if (currentUser.tokenInvalidatedAfter(decoded.iat)) {
            return res.status(401).json({
                status: 'error',
                message: 'Your session has been terminated. Please log in again.'
            });
        }

        // Check if user is active
        if (!currentUser.isActive) {
            return res.status(401).json({
                status: 'error',
                message: 'Your account has been deactivated.'
            });
        }

        // Grant access to protected route
        req.user = currentUser;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                status: 'error',
                message: 'Invalid token. Please log in again.'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                status: 'error',
                message: 'Your token has expired. Please log in again.'
            });
        }
        res.status(500).json({
            status: 'error',
            message: error.message || 'Authentication failed'
        });
    }
};

// Restrict to certain roles
export const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                status: 'error',
                message: 'You do not have permission to perform this action'
            });
        }
        next();
    };
};

// Get current user
export const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('employee');

        res.status(200).json({
            status: 'success',
            data: {
                user
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get user'
        });
    }
};

// Update password
export const updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // Get user with password
        const user = await User.findById(req.user._id).select('+password');

        // Check if current password is correct
        if (!(await user.correctPassword(currentPassword, user.password))) {
            return res.status(401).json({
                status: 'error',
                message: 'Your current password is incorrect'
            });
        }

        // Update password
        user.password = newPassword;
        await user.save();

        createSendToken(user, 200, res);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update password'
        });
    }
};

// Get all users (admin only)
export const getAllUsers = async (req, res) => {
    try {
        const users = await User.find().populate('employee');

        res.status(200).json({
            status: 'success',
            results: users.length,
            data: users
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get users'
        });
    }
};

// Update user (admin only)
export const updateUser = async (req, res) => {
    try {
        const { role, isActive, email, employeeId } = req.body;

        // Build update object with only provided fields
        const updateData = {};
        if (role !== undefined) updateData.role = role;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (email !== undefined) updateData.email = email;
        if (employeeId !== undefined) updateData.employee = employeeId || null;

        const user = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true, runValidators: true }
        ).populate('employee');

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                user
            }
        });
    } catch (error) {
        // Handle duplicate email error
        if (error.code === 11000) {
            return res.status(400).json({
                status: 'error',
                message: 'Email already exists'
            });
        }
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update user'
        });
    }
};


// Delete user (admin only)
export const deleteUser = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete user'
        });
    }
};

// Create admin user if none exists (for initial setup)
export const setupAdmin = async (req, res) => {
    try {
        // Check if any admin exists
        const adminExists = await User.findOne({ role: 'admin' });

        if (adminExists) {
            return res.status(400).json({
                status: 'error',
                message: 'Admin user already exists'
            });
        }

        // Create admin user
        const admin = await User.create({
            email: 'admin@hrcrm.com',
            password: 'admin123',
            role: 'admin'
        });

        res.status(201).json({
            status: 'success',
            message: 'Admin user created successfully',
            data: {
                email: admin.email,
                role: admin.role
            }
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create admin'
        });
    }
};

// Update FCM token for push notifications
export const updateFCMToken = async (req, res) => {
    try {
        const { fcmToken } = req.body;

        if (!fcmToken) {
            return res.status(400).json({
                status: 'error',
                message: 'FCM token is required'
            });
        }

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { fcmToken },
            { new: true }
        );

        console.log(`📲 [FCM] Token updated for user: ${user.email}`);

        res.status(200).json({
            status: 'success',
            message: 'FCM token updated successfully'
        });
    } catch (error) {
        console.error('FCM token update error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update FCM token'
        });
    }
};
