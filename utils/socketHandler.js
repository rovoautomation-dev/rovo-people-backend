import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Store active socket connections by user ID
const userSockets = new Map();

/**
 * Initialize Socket.IO handlers
 * @param {import('socket.io').Server} io - Socket.IO server instance
 */
export const initializeSocketHandler = (io) => {
    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;

            if (!token) {
                return next(new Error('Authentication token required'));
            }

            // Verify JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id).select('-password');

            if (!user || !user.isActive) {
                return next(new Error('User not found or inactive'));
            }

            // Attach user to socket
            socket.user = user;
            next();
        } catch (error) {
            console.error('Socket authentication error:', error.message);
            next(new Error('Authentication failed'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.user._id.toString();
        const userRole = socket.user.role;

        console.log(`[Socket] User connected: ${socket.user.email} (${userRole})`);

        // Store socket connection
        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId).add(socket.id);

        // Join user-specific room
        socket.join(`user:${userId}`);

        // Join role-based rooms
        socket.join(`role:${userRole}`);

        // If manager, join manager room for team notifications
        if (userRole === 'manager' || userRole === 'admin') {
            socket.join('managers');
        }

        // Admin-only room
        if (userRole === 'admin') {
            socket.join('admins');
        }

        // Handle disconnect
        socket.on('disconnect', () => {
            console.log(`[Socket] User disconnected: ${socket.user.email}`);

            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                }
            }
        });

        // Handle explicit room join for employee-manager relationship
        socket.on('join:team', (managerId) => {
            if (managerId) {
                socket.join(`team:${managerId}`);
            }
        });

        // Mark notification as read via socket
        socket.on('notification:read', async (notificationId) => {
            try {
                const Notification = (await import('../models/Notification.js')).default;
                await Notification.findOneAndUpdate(
                    { _id: notificationId, recipient: userId },
                    { isRead: true, readAt: new Date() }
                );
                // Broadcast to user's other devices
                socket.to(`user:${userId}`).emit('notification:updated', {
                    id: notificationId,
                    isRead: true
                });
            } catch (error) {
                console.error('Error marking notification as read:', error);
            }
        });
    });

    return io;
};

/**
 * Emit notification to specific user(s)
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {string|string[]} userIds - User ID(s) to notify
 * @param {Object} notification - Notification data
 */
export const emitToUsers = (io, userIds, notification) => {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    ids.forEach(userId => {
        io.to(`user:${userId}`).emit('notification:new', notification);
    });
};

/**
 * Emit notification to users by role
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {string} role - Role to notify (admin, manager, employee)
 * @param {Object} notification - Notification data
 */
export const emitToRole = (io, role, notification) => {
    io.to(`role:${role}`).emit('notification:new', notification);
};

/**
 * Emit notification to all managers and admins
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {Object} notification - Notification data
 */
export const emitToManagersAndAdmins = (io, notification) => {
    io.to('managers').emit('notification:new', notification);
};

/**
 * Emit notification to admins only
 * @param {import('socket.io').Server} io - Socket.IO server instance
 * @param {Object} notification - Notification data
 */
export const emitToAdmins = (io, notification) => {
    io.to('admins').emit('notification:new', notification);
};

/**
 * Get count of online users
 */
export const getOnlineUsersCount = () => {
    return userSockets.size;
};

/**
 * Check if a specific user is online
 * @param {string} userId - User ID to check
 */
export const isUserOnline = (userId) => {
    return userSockets.has(userId);
};

export default {
    initializeSocketHandler,
    emitToUsers,
    emitToRole,
    emitToManagersAndAdmins,
    emitToAdmins,
    getOnlineUsersCount,
    isUserOnline
};
