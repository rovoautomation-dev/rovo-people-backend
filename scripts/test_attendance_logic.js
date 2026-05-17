import 'dotenv/config';
import mongoose from 'mongoose';
import Employee from '../models/Employee.js';
import { Attendance } from '../models/Attendance.js';
import { receiveBiometricData } from '../controllers/thirdPartyController.js';
import connectDB from '../config/db.js';

const testAttendanceLogic = async () => {
    try {
        await connectDB();
        console.log('Connected to database');

        // 1. Find or create a test employee
        let employee = await Employee.findOne({ biometricId: 'TEST001' });
        if (!employee) {
            employee = await Employee.create({
                firstName: 'Test',
                lastName: 'User',
                email: 'test@example.com',
                employeeId: 'TEST001',
                biometricId: 'TEST001',
                department: 'Software',
                designation: 'Developer',
                role: 'employee'
            });
            console.log('Created test employee');
        }

        const employeeCode = 'TEST001';
        const dateStr = new Date().toISOString().split('T')[0];

        // Mock request and response
        const mockRes = {
            status: function (code) { this.statusCode = code; return this; },
            json: function (data) { this.data = data; return this; }
        };

        const mockApp = {
            get: () => null // Mock socket.io
        };

        // Test Case 1: First Punch (Check-In)
        console.log('\n--- Test Case 1: First Punch (Check-In) ---');
        const req1 = {
            method: 'POST',
            body: { employee_code: employeeCode, log_time: '09:00:00' },
            app: mockApp
        };
        await receiveBiometricData(req1, mockRes);
        console.log('Response:', JSON.stringify(mockRes.data));

        // Test Case 2: Second Punch (Check-Out)
        console.log('\n--- Test Case 2: Second Punch (Check-Out) ---');
        const req2 = {
            method: 'POST',
            body: { employee_code: employeeCode, log_time: '17:30:00' },
            app: mockApp
        };
        await receiveBiometricData(req2, mockRes);
        console.log('Response:', JSON.stringify(mockRes.data));

        // Test Case 3: Third Punch (Overwrite Check-Out)
        console.log('\n--- Test Case 3: Third Punch (Overwrite Check-Out) ---');
        const req3 = {
            method: 'POST',
            body: { employee_code: employeeCode, log_time: '18:30:00' },
            app: mockApp
        };
        await receiveBiometricData(req3, mockRes);
        console.log('Response:', JSON.stringify(mockRes.data));

        // Verification in DB
        const attendance = await Attendance.findOne({
            employee: employee._id,
            date: { $gte: new Date(dateStr) }
        });

        console.log('\n--- Database Verification ---');
        if (attendance) {
            console.log('Check-In:', attendance.checkIn);
            console.log('Check-Out (should be 18:30):', attendance.checkOut);
            console.log('Working Hours:', attendance.workingHours);
            console.log('Overtime:', attendance.overtime);
            console.log('Status:', attendance.status);
        } else {
            console.log('Attendance record not found!');
        }

        // Cleanup (optional)
        // await Attendance.deleteOne({ _id: attendance._id });
        // console.log('\nCleanup successful');

        process.exit(0);
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
};

testAttendanceLogic();
