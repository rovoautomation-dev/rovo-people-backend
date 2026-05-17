import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Employee from '../models/Employee.js';
import { Department } from '../models/Organization.js';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env vars
dotenv.config({ path: join(__dirname, '../.env') });

const migrate = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in .env');
        }

        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to DB');

        const employees = await Employee.find();
        const departments = await Department.find();

        console.log(`Found ${employees.length} employees and ${departments.length} departments.`);

        let updatedCount = 0;

        for (const emp of employees) {
            let updated = false;

            // 1. Fix Department (String Name -> ObjectId)
            // Check if department is set and NOT a valid ObjectId (implying it's a legacy string name)
            // Note: Mongoose might have cast it to string already.
            // If the schema defines it as ObjectId, accessing emp.department might allow ObjectId or null.
            // But if generic structure or strict: false, it might hold the string.
            // However, in our schema we defined it as ObjectId recently.
            // If the data in DB is string "Engineering", mongoose might throw CastError when loading?
            // Or return it if we use lean()?
            // To be safe, we should check if it's a valid ID.

            // Actually, if we just changed Schema, `emp.department` might be undefined/null if casting failed on load?
            // Unless we use lean().
            // Let's rely on `toObject()` or just checking raw values if possible, but finding by ID is easier.
            // If `emp.department` is truthy, let's see.

            // Just logically:
            // If we have existing data "Engineering", and we want to link to Department "Engineering".
            // We iterate all departments to find match.

            // To be robust:
            // If emp has a "department" field in DB that is NOT an ObjectId.
            // Since we can't easily check raw DB here without using driver directly, we assume:
            // If emp.department is null/undefined (because cast failed) or we want to re-map based on some other field?
            // Actually, if Schema says ObjectId, Mongoose might strip the invalid string "Engineering".
            // So we might lose the data if we just do Employee.find().

            // WORKAROUND: We might need to iterate raw collection or use strict: false.
            // Or assumes users will manually fix if auto-migration is too hard.
            // But let's assume valid ObjectIds are already there or we are fixing partials.

            // If `department` is missing (null), we can't guess.
            // But maybe we can fallback to searching by string match if we had a backup or if we use `lean()`.

        }

        // Simpler approach for this environment:
        // We will assume data is mostly correct or clean.
        // This script is "Best Effort".

        // Let's look for "orphaned" strings if we can. 
        // We will query using the driver to get raw data.
        const rawEmployees = await mongoose.connection.db.collection('employees').find({}).toArray();

        for (const rawEmp of rawEmployees) {
            let needsSave = false;

            // Fix Department
            if (rawEmp.department && typeof rawEmp.department === 'string' && !mongoose.Types.ObjectId.isValid(rawEmp.department)) {
                // It's a string name like "Engineering"
                const dept = departments.find(d => d.name.toLowerCase() === rawEmp.department.toLowerCase());
                if (dept) {
                    await Employee.updateOne({ _id: rawEmp._id }, { department: dept._id });
                    console.log(`Updated Department for ${rawEmp.firstName}: ${rawEmp.department} -> ${dept.name}`);
                    updatedCount++;
                }
            }

            // Fix Reporting Manager
            if (rawEmp.reportingManager && typeof rawEmp.reportingManager === 'string' && !mongoose.Types.ObjectId.isValid(rawEmp.reportingManager)) {
                // It's a string name like "John Doe"
                const nameParts = rawEmp.reportingManager.trim().split(/\s+/);
                if (nameParts.length > 0) {
                    const manager = await Employee.findOne({
                        firstName: new RegExp('^' + nameParts[0] + '$', 'i'),
                        // lastName check optional or fuzzy
                    });

                    if (manager) {
                        await Employee.updateOne({ _id: rawEmp._id }, { reportingManager: manager._id });
                        console.log(`Updated Reporting Manager for ${rawEmp.firstName}: ${rawEmp.reportingManager} -> ${manager.firstName} ${manager.lastName}`);
                        updatedCount++;
                    }
                }
            }
        }

        // 3. Fix Departments Collection (Head: String -> ObjectId)
        const rawDepts = await mongoose.connection.db.collection('departments').find({}).toArray();
        for (const rawDept of rawDepts) {
            if (rawDept.head && typeof rawDept.head === 'string' && !mongoose.Types.ObjectId.isValid(rawDept.head)) {
                // It's a string name like "Jane Doe" - try to find employee
                const nameParts = rawDept.head.trim().split(/\s+/);
                if (nameParts.length > 0) {
                    const headEmp = await Employee.findOne({
                        firstName: new RegExp('^' + nameParts[0] + '$', 'i'),
                    });

                    if (headEmp) {
                        await Department.updateOne({ _id: rawDept._id }, { head: headEmp._id });
                        console.log(`Updated Department Head for ${rawDept.name}: ${rawDept.head} -> ${headEmp.firstName} ${headEmp.lastName}`);
                        updatedCount++;
                    }
                }
            }
        }

        console.log(`Migration Complete. Updated ${updatedCount} records.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration Failed:', error);
        process.exit(1);
    }
};

migrate();
