import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import connectDB from './config/db.js';
import employeeRoutes from './routes/employeeRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import authRoutes from './routes/authRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import taskRoutes from './routes/taskRoutes.js';
import shortLeaveRoutes from './routes/shortLeaveRoutes.js';
import onDutyRoutes from './routes/onDutyRoutes.js';
import attendanceLocationRoutes from './routes/attendanceLocationRoutes.js';
import biometricRoutes from './routes/biometricRoutes.js';
import zktecoRoutes from './routes/zktecoRoutes.js';
import { initScheduler } from './utils/scheduler.js';
import { initializeSocketHandler } from './utils/socketHandler.js';
import { initializeFCM } from './utils/fcmService.js';

// Load environment variables (loaded by top-level import)
// dotenv.config();

// Connect to MongoDB
connectDB();

// Initialize Firebase Cloud Messaging
initializeFCM();

// Initialize scheduled jobs (cron)
initScheduler();

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Initialize socket handlers
initializeSocketHandler(io);

// Make io accessible to routes/controllers
app.set('io', io);

// Middleware
// Relaxed CORS for development to avoid issues with Flutter Web/Mobile
app.use(cors({
    origin: '*',
    credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Text body parser for ZKTeco ADMS protocol — MUST be before express.json()
// ZKTeco devices send raw text bodies, often with unconventional content types.
app.use('/iclock', express.text({
    type: () => true, // Parse everything as text for these routes
    limit: '10mb'
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/short-leaves', shortLeaveRoutes);
app.use('/api/on-duty', onDutyRoutes);
app.use('/api/attendance-location', attendanceLocationRoutes);
app.use('/api/biometric', biometricRoutes);
app.use('/iclock', zktecoRoutes);
// Health check route
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'HR CRM API is running',
        timestamp: new Date().toISOString(),
        socketConnections: io.engine.clientsCount || 0
    });
});

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to HR CRM API',
        version: '2.0.0',
        endpoints: {
            auth: '/api/auth',
            employees: '/api/employees',
            documents: '/api/documents',
            leaves: '/api/leaves',
            attendance: '/api/attendance',
            payroll: '/api/payroll',
            organization: '/api/organization',
            notifications: '/api/notifications',
            tasks: '/api/tasks',
            shortLeaves: '/api/short-leaves',
            onDuty: '/api/on-duty',
            biometric: '/api/biometric',
            iclock: '/iclock (ZKTeco ADMS)',
            health: '/api/health'
        },
        realtime: {
            socket: 'ws://[host]:' + (process.env.PORT || 5000),
            status: 'enabled'
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`Socket.IO enabled for real-time notifications`);
});

