import express from 'express';
import {
    uploadDocuments,
    getEmployeeDocuments,
    getPrivateDocuments,
    getMyDocuments,
    getDocument,
    updateDocument,
    deleteDocument,
    toggleDocumentVerification
} from '../controllers/documentController.js';
import { uploadDocuments as uploadMiddleware } from '../config/cloudinary.js';
import { protect, restrictTo } from '../controllers/authController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Get logged-in employee's private documents
router.get('/my-documents', getMyDocuments);

// Employee document routes
router.route('/employees/:id/documents')
    .get(getEmployeeDocuments)
    .post(uploadMiddleware.array('documents', 10), uploadDocuments);

// Private documents route (HR uploaded salary slips, etc.)
router.get('/employees/:id/private', getPrivateDocuments);

// Individual document routes
router.route('/:id')
    .get(getDocument)
    .put(updateDocument)
    .delete(deleteDocument);

// Toggle verification
router.patch('/:id/verify', restrictTo('admin', 'manager'), toggleDocumentVerification);

export default router;
