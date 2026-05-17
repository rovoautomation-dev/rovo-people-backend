import OnDutyRequest from '../models/OnDuty.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';
import { createNotification } from './notificationController.js';

// ============ ON-DUTY REQUESTS ============

// Create On-Duty Request (Employee)
export const createOnDutyRequest = async (req, res) => {
    try {
        const { purpose, expectedLocation, clientName, date, startTime, endTime, notes } = req.body;

        // Get the employee associated with this user
        const user = await User.findById(req.user._id).populate('employee');
        if (!user || !user.employee) {
            return res.status(400).json({
                success: false,
                message: 'No employee profile associated with this user'
            });
        }

        // Check for existing on-duty request on the same date
        const existingRequest = await OnDutyRequest.findOne({
            employee: user.employee._id,
            date: new Date(date)
        });

        if (existingRequest) {
            return res.status(400).json({
                success: false,
                message: 'An on-duty request already exists for this date'
            });
        }

        const onDutyRequest = await OnDutyRequest.create({
            employee: user.employee._id,
            date: new Date(date),
            purpose,
            expectedLocation,
            clientName,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            notes
        });

        // Notify managers about the new on-duty request
        const managers = await User.find({ role: { $in: ['admin', 'manager'] } });
        for (const manager of managers) {
            await createNotification({
                recipient: manager._id,
                type: 'on_duty',
                title: 'New On-Duty Request',
                message: `${user.employee.firstName} ${user.employee.lastName} has applied for on-duty on ${new Date(date).toLocaleDateString()}`,
                relatedDocument: onDutyRequest._id,
                documentModel: 'OnDutyRequest'
            });
        }

        res.status(201).json({
            success: true,
            message: 'On-duty request created successfully. You can now start tracking.',
            data: onDutyRequest
        });
    } catch (error) {
        console.error('Error creating on-duty request:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating on-duty request',
            error: error.message
        });
    }
};

// Get current user's on-duty requests
export const getMyOnDutyRequests = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('employee');
        if (!user || !user.employee) {
            return res.status(400).json({
                success: false,
                message: 'No employee profile associated with this user'
            });
        }

        const requests = await OnDutyRequest.find({ employee: user.employee._id })
            .sort({ date: -1 })
            .populate('approvedBy', 'email');

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        console.error('Error fetching on-duty requests:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching on-duty requests',
            error: error.message
        });
    }
};

// Get all on-duty requests (Admin/Manager)
export const getAllOnDutyRequests = async (req, res) => {
    try {
        const { status, trackingStatus, startDate, endDate } = req.query;

        let query = {};

        if (status) query.status = status;
        if (trackingStatus) query.trackingStatus = trackingStatus;

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        // If manager, only show their team members' requests
        if (req.user.role === 'manager') {
            const user = await User.findById(req.user._id).populate('employee');
            if (user && user.employee) {
                const teamMembers = await Employee.find({ reportingManager: user.employee._id });
                const teamMemberIds = teamMembers.map(e => e._id);
                query.employee = { $in: teamMemberIds };
            }
        }

        const requests = await OnDutyRequest.find(query)
            .populate('employee', 'firstName lastName employeeId department designation profileImage')
            .populate('approvedBy', 'email')
            .sort({ date: -1 });

        res.status(200).json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        console.error('Error fetching all on-duty requests:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching on-duty requests',
            error: error.message
        });
    }
};

// Get active tracking employees (Admin/Manager)
export const getActiveOnDutyEmployees = async (req, res) => {
    try {
        let query = { trackingStatus: 'Active' };

        // If manager, only show their team members
        if (req.user.role === 'manager') {
            const user = await User.findById(req.user._id).populate('employee');
            if (user && user.employee) {
                const teamMembers = await Employee.find({ reportingManager: user.employee._id });
                const teamMemberIds = teamMembers.map(e => e._id);
                query.employee = { $in: teamMemberIds };
            }
        }

        const activeRequests = await OnDutyRequest.find(query)
            .populate('employee', 'firstName lastName employeeId department designation profileImage phone')
            .populate({
                path: 'employee',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            });

        res.status(200).json({
            success: true,
            count: activeRequests.length,
            data: activeRequests
        });
    } catch (error) {
        console.error('Error fetching active on-duty employees:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching active employees',
            error: error.message
        });
    }
};

// Get single on-duty request
export const getOnDutyRequest = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName employeeId department designation profileImage phone')
            .populate('approvedBy', 'email')
            .populate({
                path: 'employee',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            });

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        res.status(200).json({
            success: true,
            data: request
        });
    } catch (error) {
        console.error('Error fetching on-duty request:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching on-duty request',
            error: error.message
        });
    }
};

// Approve On-Duty Request (Manager)
export const approveOnDutyRequest = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName');

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        if (request.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Request has already been processed'
            });
        }

        request.status = 'Approved';
        request.approvedBy = req.user._id;
        request.approvedAt = new Date();
        await request.save();

        // Notify employee
        const employeeUser = await User.findOne({ employee: request.employee._id });
        if (employeeUser) {
            await createNotification({
                recipient: employeeUser._id,
                type: 'on_duty',
                title: 'On-Duty Request Approved',
                message: `Your on-duty request for ${request.date.toLocaleDateString()} has been approved as paid leave.`,
                relatedDocument: request._id,
                documentModel: 'OnDutyRequest'
            });
        }

        res.status(200).json({
            success: true,
            message: 'On-duty request approved as paid leave',
            data: request
        });
    } catch (error) {
        console.error('Error approving on-duty request:', error);
        res.status(500).json({
            success: false,
            message: 'Error approving request',
            error: error.message
        });
    }
};

// Reject On-Duty Request (Manager)
export const rejectOnDutyRequest = async (req, res) => {
    try {
        const { rejectionReason } = req.body;

        const request = await OnDutyRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName');

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        if (request.status !== 'Pending') {
            return res.status(400).json({
                success: false,
                message: 'Request has already been processed'
            });
        }

        request.status = 'Rejected';
        request.rejectionReason = rejectionReason;
        request.approvedBy = req.user._id;
        request.approvedAt = new Date();
        await request.save();

        // Notify employee
        const employeeUser = await User.findOne({ employee: request.employee._id });
        if (employeeUser) {
            await createNotification({
                recipient: employeeUser._id,
                type: 'on_duty',
                title: 'On-Duty Request Rejected',
                message: `Your on-duty request for ${request.date.toLocaleDateString()} has been rejected. Reason: ${rejectionReason || 'Not specified'}`,
                relatedDocument: request._id,
                documentModel: 'OnDutyRequest'
            });
        }

        res.status(200).json({
            success: true,
            message: 'On-duty request rejected',
            data: request
        });
    } catch (error) {
        console.error('Error rejecting on-duty request:', error);
        res.status(500).json({
            success: false,
            message: 'Error rejecting request',
            error: error.message
        });
    }
};

// ============ LOCATION TRACKING ============

// Start tracking
export const startTracking = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        // Verify the request belongs to the current user
        const user = await User.findById(req.user._id).populate('employee');
        if (!user.employee || request.employee.toString() !== user.employee._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to track this request'
            });
        }

        if (request.trackingStatus === 'Active') {
            return res.status(400).json({
                success: false,
                message: 'Tracking is already active'
            });
        }

        if (request.trackingStatus === 'Completed') {
            return res.status(400).json({
                success: false,
                message: 'Tracking has already been completed for this request'
            });
        }

        request.trackingStatus = 'Active';
        request.trackingStartedAt = new Date();
        await request.save();

        res.status(200).json({
            success: true,
            message: 'Tracking started successfully',
            data: request
        });
    } catch (error) {
        console.error('Error starting tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Error starting tracking',
            error: error.message
        });
    }
};

// Update location (every 5 minutes)
export const updateLocation = async (req, res) => {
    try {
        const { latitude, longitude, address } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Latitude and longitude are required'
            });
        }

        const request = await OnDutyRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        // Verify the request belongs to the current user
        const user = await User.findById(req.user._id).populate('employee');
        if (!user.employee || request.employee.toString() !== user.employee._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        if (request.trackingStatus !== 'Active') {
            return res.status(400).json({
                success: false,
                message: 'Tracking is not active for this request'
            });
        }

        // Update location using the model method
        request.updateLocation(
            [longitude, latitude], // GeoJSON format: [lng, lat]
            address || 'Unknown location',
            new Date()
        );

        await request.save();

        res.status(200).json({
            success: true,
            message: 'Location updated successfully',
            data: {
                totalTrackedMinutes: request.totalTrackedMinutes,
                lastLocation: request.lastLocation,
                locationHistoryCount: request.locationHistory.length
            }
        });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating location',
            error: error.message
        });
    }
};

// Stop tracking
export const stopTracking = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        // Verify the request belongs to the current user
        const user = await User.findById(req.user._id).populate('employee');
        if (!user.employee || request.employee.toString() !== user.employee._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        if (request.trackingStatus !== 'Active') {
            return res.status(400).json({
                success: false,
                message: 'Tracking is not active'
            });
        }

        request.trackingStatus = 'Completed';
        request.trackingEndedAt = new Date();

        // Calculate effective attendance
        request.calculateEffectiveAttendance();

        await request.save();

        res.status(200).json({
            success: true,
            message: 'Tracking stopped',
            data: {
                totalTrackedMinutes: request.totalTrackedMinutes,
                effectiveAttendance: request.effectiveAttendance,
                locationHistory: request.locationHistory
            }
        });
    } catch (error) {
        console.error('Error stopping tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Error stopping tracking',
            error: error.message
        });
    }
};

// Get location history for a request (Admin/Manager)
export const getLocationHistory = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName employeeId');

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                employee: request.employee,
                date: request.date,
                purpose: request.purpose,
                expectedLocation: request.expectedLocation,
                clientName: request.clientName,
                trackingStatus: request.trackingStatus,
                totalTrackedMinutes: request.totalTrackedMinutes,
                effectiveAttendance: request.effectiveAttendance,
                locationHistory: request.locationHistory,
                lastLocation: request.lastLocation
            }
        });
    } catch (error) {
        console.error('Error fetching location history:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching location history',
            error: error.message
        });
    }
};

// Report location permission event (disabled, enabled, denied, granted)
export const reportPermissionEvent = async (req, res) => {
    try {
        const { event, latitude, longitude, address, deviceInfo } = req.body;
        const request = await OnDutyRequest.findById(req.params.id);

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        // Validate event type
        const validEvents = ['disabled', 'enabled', 'denied', 'granted'];
        if (!validEvents.includes(event)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid event type. Must be one of: ' + validEvents.join(', ')
            });
        }

        // Create permission event record
        const permissionEvent = {
            event,
            timestamp: new Date(),
            location: latitude && longitude ? {
                type: 'Point',
                coordinates: [longitude, latitude]
            } : undefined,
            address,
            deviceInfo: deviceInfo || {
                platform: req.headers['x-platform'] || 'unknown',
                appVersion: req.headers['x-app-version'],
                userAgent: req.headers['user-agent']
            },
            notifiedManagers: [],
            resolved: event === 'enabled' || event === 'granted'
        };

        // Add to permission history
        request.locationPermissionHistory.push(permissionEvent);
        request.lastPermissionStatus = event === 'enabled' || event === 'granted' ? 'granted' : 'denied';

        await request.save();

        // Notify managers only for disabled/denied events
        if (event === 'disabled' || event === 'denied') {
            const managers = await User.find({ role: { $in: ['admin', 'manager'] } });
            const employee = await Employee.findById(request.employee);

            const notifiedManagers = [];

            for (const manager of managers) {
                await createNotification({
                    recipient: manager._id,
                    type: 'alert',
                    title: 'Location Permission Alert',
                    message: `${employee.firstName} ${employee.lastName}'s location permission has been ${event} during on-duty tracking.`,
                    relatedDocument: request._id,
                    documentModel: 'OnDutyRequest'
                });

                notifiedManagers.push({
                    managerId: manager._id,
                    notifiedAt: new Date(),
                    notificationMethod: 'in-app'
                });
            }

            // Update the event with notified managers
            const lastEvent = request.locationPermissionHistory[request.locationPermissionHistory.length - 1];
            lastEvent.notifiedManagers = notifiedManagers;
            await request.save();
        }

        res.status(200).json({
            success: true,
            message: `Permission ${event} event recorded`,
            data: {
                event,
                timestamp: permissionEvent.timestamp,
                notificationsSent: event === 'disabled' || event === 'denied'
            }
        });
    } catch (error) {
        console.error('Error reporting permission event:', error);
        res.status(500).json({
            success: false,
            message: 'Error reporting permission event',
            error: error.message
        });
    }
};

// Get permission history for a request
export const getPermissionHistory = async (req, res) => {
    try {
        const request = await OnDutyRequest.findById(req.params.id)
            .populate('employee', 'firstName lastName')
            .populate('locationPermissionHistory.notifiedManagers.managerId', 'email');

        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'On-duty request not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                requestId: request._id,
                employee: request.employee,
                lastPermissionStatus: request.lastPermissionStatus,
                permissionHistory: request.locationPermissionHistory.map(event => ({
                    event: event.event,
                    timestamp: event.timestamp,
                    location: event.location,
                    address: event.address,
                    deviceInfo: event.deviceInfo,
                    notifiedManagers: event.notifiedManagers,
                    resolved: event.resolved,
                    resolvedAt: event.resolvedAt
                })),
                totalDisabledEvents: request.locationPermissionHistory.filter(e =>
                    e.event === 'disabled' || e.event === 'denied'
                ).length,
                unresolvedEvents: request.locationPermissionHistory.filter(e =>
                    (e.event === 'disabled' || e.event === 'denied') && !e.resolved
                ).length
            }
        });
    } catch (error) {
        console.error('Error fetching permission history:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching permission history',
            error: error.message
        });
    }
};

// Backward compatibility - redirect old endpoint to new one
export const reportLocationDisabled = async (req, res) => {
    req.body.event = 'disabled';
    return reportPermissionEvent(req, res);
};
