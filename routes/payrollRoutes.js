import express from 'express';
import { protect, restrictTo } from '../controllers/authController.js';
import {
    getSalaryStructures,
    createSalaryStructure,
    updateSalaryStructure,
    deleteSalaryStructure,
    getPayrolls,
    getPayroll,
    generatePayroll,
    updatePayroll,
    processPayroll,
    markPaid,
    deletePayroll,
    getPayrollStats,
    getEmployeePayslips,
    generatePayslipPDF,
    downloadPayslip
} from '../controllers/payrollController.js';

const router = express.Router();

// Protect all routes
router.use(protect);

// Allow employees to access specific routes, restrict others to admin/manager

// Salary Structures
router.route('/structures')
    .get(getSalaryStructures)
    .post(restrictTo('admin'), createSalaryStructure);

router.route('/structures/:id')
    .patch(restrictTo('admin'), updateSalaryStructure)
    .delete(restrictTo('admin'), deleteSalaryStructure);

// Payroll
router.get('/stats', restrictTo('admin', 'manager'), getPayrollStats);
router.get('/payslips', getEmployeePayslips);

router.route('/')
    .get(getPayrolls)
    .post(restrictTo('admin'), generatePayroll);

router.route('/:id')
    .get(getPayroll)
    .patch(restrictTo('admin'), updatePayroll)
    .delete(restrictTo('admin'), deletePayroll);

router.post('/process', restrictTo('admin'), processPayroll);
router.post('/mark-paid', restrictTo('admin'), markPaid);

// PDF Payslip generation
router.post('/:id/generate-pdf', restrictTo('admin', 'manager'), generatePayslipPDF);
router.get('/:id/download', downloadPayslip);

export default router;
