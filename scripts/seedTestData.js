import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Employee from '../models/Employee.js';
import { Department } from '../models/Organization.js';
import bcrypt from 'bcryptjs';

dotenv.config();

const seedTestData = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://hr_user:hr_password@localhost:27017/hr-crm');
        console.log('✅ Connected to MongoDB');

        // Clear existing data
        console.log('🗑️  Clearing existing users and employees...');
        await User.deleteMany({});
        await Employee.deleteMany({});

        // Create Departments
        console.log('🏢 Creating departments...');
        await Department.deleteMany({});

        const managementDept = await Department.create({
            name: 'Management',
            description: 'Management and Administration',
            headOfDepartment: null
        });

        const salesDept = await Department.create({
            name: 'Sales',
            description: 'Sales and Business Development',
            headOfDepartment: null
        });

        const techDept = await Department.create({
            name: 'Technology',
            description: 'IT and Development',
            headOfDepartment: null
        });

        console.log('✅ Departments created');

        // Create Admin User
        console.log('\n👤 Creating admin user...');
        const adminPassword = await bcrypt.hash('admin123', 12);
        const adminUser = await User.create({
            email: 'admin@hrcrm.com',
            password: adminPassword,
            role: 'admin',
            isActive: true
        });

        // Create Admin Employee Record
        console.log('👔 Creating admin employee record...');
        const adminEmployee = await Employee.create({
            firstName: 'Admin',
            lastName: 'User',
            email: 'admin@hrcrm.com',
            phone: '+91 9876543210',
            employeeId: 'EMP001',
            department: managementDept._id,
            designation: 'System Administrator',
            dateOfJoining: new Date('2024-01-01'),
            salary: 100000,
            status: 'Active',
            contactNumber: '+91 9876543210',
            address: {
                street: '123 Admin Street',
                city: 'Mumbai',
                state: 'Maharashtra',
                pincode: '400001',
                country: 'India'
            }
        });

        // Link admin user to employee
        adminUser.employee = adminEmployee._id;
        await adminUser.save();

        console.log('✅ Admin user created:');
        console.log('   Email: admin@hrcrm.com');
        console.log('   Password: admin123');
        console.log('   Employee ID: EMP001');

        // Create Manager User
        console.log('\n👤 Creating manager user...');
        const managerPassword = await bcrypt.hash('manager123', 12);
        const managerUser = await User.create({
            email: 'manager@hrcrm.com',
            password: managerPassword,
            role: 'manager',
            isActive: true
        });

        const managerEmployee = await Employee.create({
            firstName: 'John',
            lastName: 'Manager',
            email: 'manager@hrcrm.com',
            phone: '+91 9876543211',
            employeeId: 'EMP002',
            department: salesDept._id,
            designation: 'Sales Manager',
            dateOfJoining: new Date('2024-02-01'),
            salary: 80000,
            status: 'Active',
            contactNumber: '+91 9876543211',
            address: {
                street: '456 Manager Lane',
                city: 'Delhi',
                state: 'Delhi',
                pincode: '110001',
                country: 'India'
            }
        });

        managerUser.employee = managerEmployee._id;
        await managerUser.save();

        console.log('✅ Manager user created:');
        console.log('   Email: manager@hrcrm.com');
        console.log('   Password: manager123');
        console.log('   Employee ID: EMP002');

        // Create Employee User
        console.log('\n👤 Creating employee user...');
        const employeePassword = await bcrypt.hash('employee123', 12);
        const employeeUser = await User.create({
            email: 'employee@hrcrm.com',
            password: employeePassword,
            role: 'employee',
            isActive: true
        });

        const employeeRecord = await Employee.create({
            firstName: 'Jane',
            lastName: 'Employee',
            email: 'employee@hrcrm.com',
            phone: '+91 9876543212',
            employeeId: 'EMP003',
            department: salesDept._id,
            designation: 'Sales Executive',
            reportingManager: managerEmployee._id,
            dateOfJoining: new Date('2024-03-01'),
            salary: 50000,
            status: 'Active',
            contactNumber: '+91 9876543212',
            address: {
                street: '789 Employee Road',
                city: 'Bangalore',
                state: 'Karnataka',
                pincode: '560001',
                country: 'India'
            }
        });

        employeeUser.employee = employeeRecord._id;
        await employeeUser.save();

        console.log('✅ Employee user created:');
        console.log('   Email: employee@hrcrm.com');
        console.log('   Password: employee123');
        console.log('   Employee ID: EMP003');

        console.log('\n✅ Test data seeded successfully!');
        console.log('\n📝 Login Credentials:');
        console.log('   Admin:    admin@hrcrm.com / admin123');
        console.log('   Manager:  manager@hrcrm.com / manager123');
        console.log('   Employee: employee@hrcrm.com / employee123');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding data:', error);
        process.exit(1);
    }
};

seedTestData();
