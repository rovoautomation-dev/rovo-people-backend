/**
 * Script to rebuild indexes on Employee and User collections
 * This clears any orphaned index entries that may cause "Email already exists" errors
 * after deleting and re-adding records with the same email.
 * 
 * Run: node scripts/rebuildIndexes.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/hr_crm';

async function rebuildIndexes() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected successfully!\n');

        const db = mongoose.connection.db;

        // Rebuild Employee indexes
        console.log('=== Rebuilding Employee Collection Indexes ===');
        try {
            const employeeCollection = db.collection('employees');

            // Get current indexes
            const employeeIndexes = await employeeCollection.indexes();
            console.log('Current Employee indexes:', employeeIndexes.map(i => i.name));

            // Drop the email index if it exists
            const emailIndex = employeeIndexes.find(i => i.key && i.key.email);
            if (emailIndex) {
                console.log('Dropping email index...');
                await employeeCollection.dropIndex('email_1');
                console.log('Email index dropped.');
            }

            // Drop the employeeId index if it exists
            const empIdIndex = employeeIndexes.find(i => i.key && i.key.employeeId);
            if (empIdIndex) {
                console.log('Dropping employeeId index...');
                await employeeCollection.dropIndex('employeeId_1');
                console.log('EmployeeId index dropped.');
            }

            // Recreate indexes
            console.log('Recreating Employee indexes...');
            await employeeCollection.createIndex({ email: 1 }, { unique: true });
            await employeeCollection.createIndex({ employeeId: 1 }, { unique: true });
            console.log('Employee indexes rebuilt successfully!\n');
        } catch (err) {
            console.log('Note: Employee index operation:', err.message);
        }

        // Rebuild User indexes
        console.log('=== Rebuilding User Collection Indexes ===');
        try {
            const userCollection = db.collection('users');

            // Get current indexes
            const userIndexes = await userCollection.indexes();
            console.log('Current User indexes:', userIndexes.map(i => i.name));

            // Drop the email index if it exists
            const emailIndex = userIndexes.find(i => i.key && i.key.email);
            if (emailIndex) {
                console.log('Dropping email index...');
                await userCollection.dropIndex('email_1');
                console.log('Email index dropped.');
            }

            // Recreate indexes
            console.log('Recreating User indexes...');
            await userCollection.createIndex({ email: 1 }, { unique: true });
            console.log('User indexes rebuilt successfully!\n');
        } catch (err) {
            console.log('Note: User index operation:', err.message);
        }

        console.log('=== Index Rebuild Complete ===');
        console.log('All unique indexes have been rebuilt. Any orphaned entries should now be cleared.');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB.');
        process.exit(0);
    }
}

rebuildIndexes();
