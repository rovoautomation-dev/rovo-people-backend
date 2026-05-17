import 'dotenv/config';
import { uploadDocuments } from '../config/cloudinary.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a test PDF file
const testPdfPath = path.join(__dirname, 'test.pdf');
fs.writeFileSync(testPdfPath, '%PDF-1.4\n%Test PDF\n%%EOF');

console.log('Test file created:', testPdfPath);
console.log('File exists:', fs.existsSync(testPdfPath));
console.log('File size:', fs.statSync(testPdfPath).size, 'bytes');

// Simulate multer file object
const mockFile = {
    fieldname: 'documents',
    originalname: 'test.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    path: testPdfPath,
    size: fs.statSync(testPdfPath).size
};

// Test the upload
const upload = uploadDocuments.single('documents');

// Create mock req/res
const mockReq = {
    file: mockFile,
    body: {}
};

const mockRes = {
    status: (code) => ({
        json: (data) => console.log('Response:', code, data)
    })
};

console.log('\nTesting upload with multer...');
upload(mockReq, mockRes, (err) => {
    if (err) {
        console.error('Upload error:', err);
    } else {
        console.log('\nUploaded file info:');
        console.log('Path:', mockReq.file.path);
        console.log('Filename:', mockReq.file.filename);
        console.log('Full file object:', JSON.stringify(mockReq.file, null, 2));
    }

    // Cleanup
    if (fs.existsSync(testPdfPath)) {
        fs.unlinkSync(testPdfPath);
        console.log('\nTest file cleaned up');
    }
});
