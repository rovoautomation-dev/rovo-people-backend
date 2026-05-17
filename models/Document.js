import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    originalName: {
        type: String,
        required: true
    },
    documentType: {
        type: String,
        enum: [
            'Resume',
            'ID Proof',
            'Address Proof',
            'Educational Certificate',
            'Experience Letter',
            'Offer Letter',
            'Salary Slip',
            'Tax Document',
            'Contract',
            'Performance Review',
            'Other'
        ],
        default: 'Other'
    },
    fileUrl: {
        type: String,
        required: true
    },
    publicId: {
        type: String,
        required: true
    },
    fileType: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number
    },
    uploadedBy: {
        type: String,
        default: 'HR Admin'
    },
    description: {
        type: String,
        trim: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    isPrivate: {
        type: Boolean,
        default: false
    },
    uploadedByUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Index for faster queries
documentSchema.index({ employee: 1, documentType: 1 });

const Document = mongoose.model('Document', documentSchema);

export default Document;
