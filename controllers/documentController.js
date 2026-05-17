import Document from '../models/Document.js';
import Employee from '../models/Employee.js';
import { cloudinary } from '../config/cloudinary.js';

// @desc    Upload documents for an employee
// @route   POST /api/employees/:id/documents
export const uploadDocuments = async (req, res) => {
    try {
        console.log('=== UPLOAD START ===');
        console.log('Employee ID:', req.params.id);
        console.log('Files received:', req.files?.length || 0);
        console.log('Body:', req.body);

        const employee = await Employee.findById(req.params.id);

        if (!employee) {
            console.log('Employee not found');
            return res.status(404).json({ success: false, message: 'Employee not found' });
        }

        if (!req.files || req.files.length === 0) {
            console.log('No files in request');
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const { documentType = 'Other', description = '', isPrivate = false } = req.body;
        const uploadedDocs = [];

        for (const file of req.files) {
            console.log('\nProcessing file:', file.originalname);
            console.log('File path:', file.path);
            console.log('File filename:', file.filename);
            console.log('File mimetype:', file.mimetype);
            console.log('File size:', file.size);

            const document = new Document({
                employee: employee._id,
                name: file.originalname.split('.')[0],
                originalName: file.originalname,
                documentType,
                fileUrl: file.path,
                publicId: file.filename,
                fileType: file.mimetype,
                fileSize: file.size,
                description,
                isPrivate: isPrivate === 'true' || isPrivate === true,
                uploadedByUser: req.user?._id
            });

            console.log('Document object created:', document);
            await document.save();
            console.log('Document saved to DB');

            // Add document reference to employee
            employee.documents.push(document._id);
            uploadedDocs.push(document);
        }

        await employee.save();
        console.log('Employee updated with document references');
        console.log('=== UPLOAD COMPLETE ===\n');

        res.status(201).json({
            success: true,
            message: `${uploadedDocs.length} document(s) uploaded successfully`,
            data: uploadedDocs
        });
    } catch (error) {
        console.error('=== UPLOAD ERROR ===');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('===================\n');
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get all documents for an employee
// @route   GET /api/employees/:id/documents
export const getEmployeeDocuments = async (req, res) => {
    try {
        const employeeId = req.params.id;

        // Build query based on user role
        let query = { employee: employeeId };

        // If user is an employee, they can only see:
        // 1. Non-private documents, OR
        // 2. Private documents where they are the owner
        if (req.user?.role === 'employee') {
            const userEmployeeId = req.user.employee?._id || req.user.employee;

            // If viewing their own profile, show their private docs
            if (userEmployeeId?.toString() === employeeId.toString()) {
                // Show all docs (both private and non-private for their own profile)
            } else {
                // If somehow viewing another profile, only show non-private
                query.isPrivate = { $ne: true };
            }
        }
        // Admin/Manager can see all documents

        const documents = await Document.find(query)
            .sort({ createdAt: -1 });

        res.json({ success: true, data: documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get private documents for an employee (HR Section)
// @route   GET /api/documents/employees/:id/private
export const getPrivateDocuments = async (req, res) => {
    try {
        const employeeId = req.params.id;

        // Only show private documents
        const documents = await Document.find({
            employee: employeeId,
            isPrivate: true
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get logged-in employee's documents (My Documents)
// @route   GET /api/documents/my-documents
export const getMyDocuments = async (req, res) => {
    try {
        const employeeId = req.user.employee?._id || req.user.employee;

        if (!employeeId) {
            return res.json({
                success: true,
                data: []
            });
        }

        // Get ALL documents for this employee (both private and public)
        const documents = await Document.find({
            employee: employeeId
        }).sort({ createdAt: -1 });

        res.json({ success: true, data: documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get single document
// @route   GET /api/documents/:id
export const getDocument = async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        res.json({ success: true, data: document });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update document details
// @route   PUT /api/documents/:id
export const updateDocument = async (req, res) => {
    try {
        const { name, documentType, description, isVerified } = req.body;

        const document = await Document.findByIdAndUpdate(
            req.params.id,
            { name, documentType, description, isVerified },
            { new: true, runValidators: true }
        );

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        res.json({ success: true, data: document });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete document
// @route   DELETE /api/documents/:id
export const deleteDocument = async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        // Delete from Cloudinary
        const resourceType = document.fileType.startsWith('image/') ? 'image' : 'raw';
        await cloudinary.uploader.destroy(document.publicId, { resource_type: resourceType });

        // Remove reference from employee
        await Employee.findByIdAndUpdate(document.employee, {
            $pull: { documents: document._id }
        });

        // Delete document record
        await Document.findByIdAndDelete(req.params.id);

        res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Verify/Unverify document
// @route   PATCH /api/documents/:id/verify
export const toggleDocumentVerification = async (req, res) => {
    try {
        const document = await Document.findById(req.params.id);

        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        document.isVerified = !document.isVerified;
        await document.save();

        res.json({
            success: true,
            message: `Document ${document.isVerified ? 'verified' : 'unverified'}`,
            data: document
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
