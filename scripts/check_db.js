import 'dotenv/config';
import mongoose from 'mongoose';
import Document from '../models/Document.js';

// Connect to MongoDB
await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

// Find the most recent document
const recentDoc = await Document.findOne().sort({ createdAt: -1 });

if (recentDoc) {
    console.log('\nMost recent document:');
    console.log('Name:', recentDoc.name);
    console.log('Original Name:', recentDoc.originalName);
    console.log('File URL:', recentDoc.fileUrl);
    console.log('Public ID:', recentDoc.publicId);
    console.log('File Type:', recentDoc.fileType);
    console.log('Created:', recentDoc.createdAt);
} else {
    console.log('No documents found');
}

await mongoose.connection.close();
