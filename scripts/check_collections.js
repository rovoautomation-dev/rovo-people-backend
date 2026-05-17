import 'dotenv/config';
import mongoose from 'mongoose';

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

// List all collections
const collections = await mongoose.connection.db.listCollections().toArray();
console.log('\nAvailable collections:');
collections.forEach(col => console.log(' -', col.name));

// Check documents collection
const documentsCol = mongoose.connection.db.collection('documents');
const docCount = await documentsCol.countDocuments();
console.log('\nDocuments count:', docCount);

if (docCount > 0) {
    const recentDoc = await documentsCol.findOne({}, { sort: { createdAt: -1 } });
    console.log('\nMost recent document:');
    console.log(JSON.stringify(recentDoc, null, 2));
}

await mongoose.connection.close();
