import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Task } from '../models/Task.js';
import Employee from '../models/Employee.js';
import User from '../models/User.js';

dotenv.config();

const seedTasks = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Get all employees
        const employees = await Employee.find({ status: 'Active' });
        if (employees.length === 0) {
            console.log('❌ No employees found. Please run seedTestData.js first.');
            process.exit(1);
        }

        console.log(`📋 Found ${employees.length} employees`);

        // Get an admin/manager user for createdBy
        const adminUser = await User.findOne({ role: 'admin' });
        if (!adminUser) {
            console.log('❌ No admin user found. Please run seedTestData.js first.');
            process.exit(1);
        }

        // Clear existing tasks
        console.log('🗑️  Clearing existing tasks...');
        await Task.deleteMany({});

        // Sample tasks data
        const tasksData = [
            {
                title: 'Complete Q1 Sales Report',
                description: 'Prepare the quarterly sales report with all KPIs and metrics for Q1 2024.',
                status: 'In Progress',
                priority: 'High',
                category: 'Administrative',
                tags: ['report', 'sales', 'quarterly'],
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
                estimatedHours: 8
            },
            {
                title: 'Client Presentation Preparation',
                description: 'Prepare presentation slides for the upcoming client meeting about new product features.',
                status: 'Todo',
                priority: 'Urgent',
                category: 'Meeting',
                tags: ['client', 'presentation', 'meeting'],
                dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
                estimatedHours: 4
            },
            {
                title: 'Update Employee Handbook',
                description: 'Review and update the employee handbook with latest company policies.',
                status: 'Todo',
                priority: 'Medium',
                category: 'Documentation',
                tags: ['documentation', 'policy', 'HR'],
                dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
                estimatedHours: 12
            },
            {
                title: 'Fix Login Bug',
                description: 'Investigate and fix the login issue reported by clients on mobile devices.',
                status: 'In Progress',
                priority: 'High',
                category: 'Development',
                tags: ['bug', 'mobile', 'urgent'],
                dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
                estimatedHours: 6
            },
            {
                title: 'Team Training Session',
                description: 'Conduct training session for new team members on project management tools.',
                status: 'Todo',
                priority: 'Medium',
                category: 'Meeting',
                tags: ['training', 'team', 'onboarding'],
                dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
                estimatedHours: 3
            },
            {
                title: 'Code Review - Feature Branch',
                description: 'Review the feature branch for the new dashboard implementation.',
                status: 'In Review',
                priority: 'Medium',
                category: 'Development',
                tags: ['code-review', 'dashboard'],
                dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
                estimatedHours: 2
            },
            {
                title: 'Database Optimization',
                description: 'Optimize slow database queries and add proper indexes.',
                status: 'Todo',
                priority: 'High',
                category: 'Development',
                tags: ['database', 'performance', 'optimization'],
                dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days from now
                estimatedHours: 16
            },
            {
                title: 'Monthly Newsletter',
                description: 'Draft and send the monthly company newsletter to all employees.',
                status: 'Completed',
                priority: 'Low',
                category: 'Administrative',
                tags: ['newsletter', 'communication'],
                dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
                completedAt: new Date(),
                estimatedHours: 2,
                actualHours: 2.5
            },
            {
                title: 'API Documentation Update',
                description: 'Update the API documentation with new endpoints and examples.',
                status: 'In Progress',
                priority: 'Medium',
                category: 'Documentation',
                tags: ['api', 'documentation', 'development'],
                dueDate: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 days from now
                estimatedHours: 8
            },
            {
                title: 'Security Audit',
                description: 'Conduct a comprehensive security audit of the application.',
                status: 'Todo',
                priority: 'Urgent',
                category: 'Development',
                tags: ['security', 'audit', 'critical'],
                dueDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000), // 4 days from now
                estimatedHours: 20
            }
        ];

        console.log('📝 Creating tasks...');

        // Create tasks and assign to employees
        for (let i = 0; i < tasksData.length; i++) {
            const taskData = tasksData[i];
            const assignee = employees[i % employees.length]; // Distribute tasks among employees

            await Task.create({
                ...taskData,
                assignee: assignee._id,
                createdBy: adminUser._id
            });

            console.log(`   ✅ Created: "${taskData.title}" -> Assigned to: ${assignee.firstName} ${assignee.lastName}`);
        }

        console.log(`\n✅ Successfully created ${tasksData.length} tasks!`);

        // Show task distribution
        console.log('\n📊 Task Distribution:');
        for (const employee of employees) {
            const count = await Task.countDocuments({ assignee: employee._id });
            console.log(`   ${employee.firstName} ${employee.lastName}: ${count} tasks`);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding tasks:', error);
        process.exit(1);
    }
};

seedTasks();
