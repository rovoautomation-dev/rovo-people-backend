import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Storage for profile images
const profileImageStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'hr-crm/profiles',
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
        transformation: [{ width: 300, height: 300, crop: 'fill' }]
    }
});

// Storage for documents (supports multiple formats)
const documentStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'hr-crm/documents',
        resource_type: 'raw',
        type: 'upload', // 'upload' type makes files publicly accessible
        use_filename: true,
        unique_filename: false,
        public_id: (req, file) => {
            // Keep the full filename including extension
            // Replace spaces and special chars with underscores for URL safety
            return file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        }
    }
});

export const uploadProfileImage = multer({ storage: profileImageStorage });
export const uploadDocuments = multer({ storage: documentStorage });
export { cloudinary };
