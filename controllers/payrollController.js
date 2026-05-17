import { SalaryStructure, Payroll, Payslip } from '../models/Payroll.js';
import Employee from '../models/Employee.js';
import { Attendance } from '../models/Attendance.js';
import Document from '../models/Document.js';
import { Settings } from '../models/Organization.js';
import { cloudinary } from '../config/cloudinary.js';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { notifyPayrollEvent } from './notificationController.js';

// ============ SALARY STRUCTURES ============

// Get all salary structures
export const getSalaryStructures = async (req, res) => {
    try {
        const structures = await SalaryStructure.find().sort({ name: 1 });
        res.status(200).json({
            status: 'success',
            results: structures.length,
            data: structures
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get salary structures'
        });
    }
};

// Create salary structure
export const createSalaryStructure = async (req, res) => {
    try {
        const structure = await SalaryStructure.create(req.body);
        res.status(201).json({
            status: 'success',
            data: structure
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to create salary structure'
        });
    }
};

// Update salary structure
export const updateSalaryStructure = async (req, res) => {
    try {
        const structure = await SalaryStructure.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!structure) {
            return res.status(404).json({
                status: 'error',
                message: 'Salary structure not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: structure
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update salary structure'
        });
    }
};

// Delete salary structure
export const deleteSalaryStructure = async (req, res) => {
    try {
        const structure = await SalaryStructure.findByIdAndDelete(req.params.id);

        if (!structure) {
            return res.status(404).json({
                status: 'error',
                message: 'Salary structure not found'
            });
        }

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete salary structure'
        });
    }
};

// ============ PAYROLL ============

// Get all payroll records
export const getPayrolls = async (req, res) => {
    try {
        const { month, year, status, employee, department } = req.query;
        const query = {};

        if (month) query.month = parseInt(month);
        if (year) query.year = parseInt(year);
        if (status) query.status = status;

        // If user is basic employee, force filter by their employee ID
        if (req.user.role === 'employee') {
            query.employee = req.user.employee;
        } else if (employee) {
            query.employee = employee;
        }

        let payrolls = await Payroll.find(query)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department designation profileImage',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            })
            .populate('processedBy', 'email')
            .sort({ year: -1, month: -1 });

        // Filter by department if specified
        if (department) {
            payrolls = payrolls.filter(p => p.employee?.department?._id?.toString() === department);
        }

        res.status(200).json({
            status: 'success',
            results: payrolls.length,
            data: payrolls
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get payrolls'
        });
    }
};

// Get payroll by ID
export const getPayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id)
            .populate('employee', 'firstName lastName employeeId department designation email phone bankDetails')
            .populate('processedBy', 'email');

        if (!payroll) {
            return res.status(404).json({
                status: 'error',
                message: 'Payroll not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: payroll
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get payroll'
        });
    }
};

// Generate payroll for a month
export const generatePayroll = async (req, res) => {
    try {
        const { month, year, employees } = req.body;

        if (!month || !year) {
            return res.status(400).json({
                status: 'error',
                message: 'Month and year are required'
            });
        }

        // Get employees to process
        const employeeQuery = employees && employees.length > 0
            ? { _id: { $in: employees }, status: 'Active' }
            : { status: 'Active' };

        const employeeList = await Employee.find(employeeQuery)
            .populate('salaryStructure');

        if (employeeList.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No active employees found to generate payroll'
            });
        }

        const generatedPayrolls = [];
        const errors = [];

        for (const emp of employeeList) {
            try {
                // Check if payroll already exists
                const existing = await Payroll.findOne({
                    employee: emp._id,
                    month,
                    year
                });

                if (existing) {
                    errors.push({
                        employee: `${emp.firstName} ${emp.lastName}`,
                        error: 'Payroll already exists for this month'
                    });
                    continue;
                }

                // Check if employee has salary defined
                if (!emp.salary || emp.salary <= 0) {
                    errors.push({
                        employee: `${emp.firstName} ${emp.lastName}`,
                        error: 'No salary defined for this employee'
                    });
                    continue;
                }

                // Get attendance for the month
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0);

                const attendance = await Attendance.find({
                    employee: emp._id,
                    date: { $gte: startDate, $lte: endDate }
                });

                const presentDays = attendance.filter(a => a.status === 'Present').length;
                const leaveDays = attendance.filter(a => a.status === 'On Leave').length;
                const totalOvertimeHours = attendance.reduce((sum, a) => sum + (a.overtime || 0), 0);

                // Calculate monthly salary from annual package
                const annualSalary = emp.salary; // This is the LPA value
                const monthlySalary = annualSalary / 12;

                // Get salary structure components or use defaults
                const structure = emp.salaryStructure;
                let earnings = [];
                let deductions = [];

                console.log(`Processing payroll for ${emp.firstName} ${emp.lastName}`);
                console.log('Salary Structure:', structure ? `Found: ${structure.name}` : 'Not assigned');
                console.log('Components count:', structure?.components?.length || 0);

                if (structure && structure.components && structure.components.length > 0) {
                    // Use employee's assigned salary structure
                    // All percentage calculations are based on monthly salary (CTC)
                    for (const comp of structure.components) {
                        let amount = 0;

                        if (comp.calculationType === 'Fixed') {
                            amount = comp.value;
                        } else if (comp.calculationType === 'Percentage') {
                            // Percentage is based on monthly salary (CTC)
                            amount = monthlySalary * (comp.value / 100);
                        }

                        if (comp.type === 'Earning') {
                            earnings.push({ name: comp.name, amount: Math.round(amount) });
                        } else {
                            deductions.push({ name: comp.name, amount: Math.round(amount) });
                        }
                    }

                    console.log('Earnings calculated:', earnings);
                    console.log('Deductions calculated:', deductions);
                } else {
                    // Use default structure based on monthly salary
                    // Standard Indian salary structure: Basic 50%, HRA 40% of Basic, etc.
                    const basicSalary = monthlySalary * 0.5;

                    earnings = [
                        { name: 'Basic Salary', amount: Math.round(basicSalary) },
                        { name: 'HRA', amount: Math.round(basicSalary * 0.4) },
                        { name: 'Conveyance Allowance', amount: 1600 },
                        { name: 'Medical Allowance', amount: 1250 },
                        { name: 'Special Allowance', amount: Math.round(monthlySalary - basicSalary - (basicSalary * 0.4) - 2850) }
                    ];

                    deductions = [
                        { name: 'Provident Fund (PF)', amount: Math.round(basicSalary * 0.12) },
                        { name: 'Professional Tax', amount: 200 },
                        { name: 'Income Tax (TDS)', amount: Math.round(basicSalary * 0.1) }
                    ];
                }

                // Add overtime if applicable
                const basicForOT = earnings.find(e => e.name.toLowerCase().includes('basic'))?.amount || monthlySalary * 0.5;
                const overtimePay = totalOvertimeHours * (basicForOT / 176); // 176 working hours per month
                if (totalOvertimeHours > 0) {
                    earnings.push({ name: 'Overtime Pay', amount: Math.round(overtimePay) });
                }

                const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
                const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);

                const payroll = await Payroll.create({
                    employee: emp._id,
                    month,
                    year,
                    basicSalary: earnings.find(e => e.name.toLowerCase().includes('basic'))?.amount || Math.round(monthlySalary * 0.5),
                    earnings,
                    deductions,
                    grossSalary: Math.round(totalEarnings),
                    totalDeductions: Math.round(totalDeductions),
                    netSalary: Math.round(totalEarnings - totalDeductions),
                    workingDays: endDate.getDate(),
                    presentDays,
                    leaveDays,
                    overtime: {
                        hours: totalOvertimeHours,
                        amount: Math.round(overtimePay)
                    },
                    status: 'Draft'
                });

                generatedPayrolls.push(payroll);
            } catch (err) {
                console.error(`Error generating payroll for ${emp.firstName}:`, err);
                errors.push({
                    employee: `${emp.firstName} ${emp.lastName}`,
                    error: err.message
                });
            }
        }

        res.status(201).json({
            status: 'success',
            message: `Generated ${generatedPayrolls.length} payroll(s)`,
            data: {
                generated: generatedPayrolls.length,
                errors: errors.length,
                details: errors
            }
        });
    } catch (error) {
        console.error('Generate payroll error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to generate payroll'
        });
    }
};

// Update payroll
export const updatePayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        ).populate('employee', 'firstName lastName employeeId department designation');

        if (!payroll) {
            return res.status(404).json({
                status: 'error',
                message: 'Payroll not found'
            });
        }

        res.status(200).json({
            status: 'success',
            data: payroll
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to update payroll'
        });
    }
};

// Process payroll (mark as processed)
export const processPayroll = async (req, res) => {
    try {
        const { payrollIds } = req.body;

        const updated = await Payroll.updateMany(
            { _id: { $in: payrollIds }, status: { $in: ['Draft', 'Pending'] } },
            {
                status: 'Processed',
                processedBy: req.user._id
            }
        );

        // Send notifications to affected employees
        const processedPayrolls = await Payroll.find({ _id: { $in: payrollIds } })
            .populate('employee');
        for (const payroll of processedPayrolls) {
            if (payroll.employee) {
                await notifyPayrollEvent(payroll, payroll.employee, 'processed', req.app);
            }
        }

        res.status(200).json({
            status: 'success',
            message: `Processed ${updated.modifiedCount} payrolls`
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to process payroll'
        });
    }
};

// Mark payroll as paid
export const markPaid = async (req, res) => {
    try {
        const { payrollIds, paymentDate, paymentMethod } = req.body;

        const updated = await Payroll.updateMany(
            { _id: { $in: payrollIds }, status: 'Processed' },
            {
                status: 'Paid',
                paymentDate: paymentDate || new Date(),
                paymentMethod: paymentMethod || 'Bank Transfer'
            }
        );

        // Send notifications to affected employees
        const paidPayrolls = await Payroll.find({ _id: { $in: payrollIds } })
            .populate('employee');
        for (const payroll of paidPayrolls) {
            if (payroll.employee) {
                await notifyPayrollEvent(payroll, payroll.employee, 'paid', req.app);
            }
        }

        res.status(200).json({
            status: 'success',
            message: `Marked ${updated.modifiedCount} payrolls as paid`
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to mark payroll as paid'
        });
    }
};

// Delete payroll
export const deletePayroll = async (req, res) => {
    try {
        const payroll = await Payroll.findById(req.params.id);

        if (!payroll) {
            return res.status(404).json({
                status: 'error',
                message: 'Payroll not found'
            });
        }

        if (payroll.status === 'Paid') {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete paid payroll records'
            });
        }

        await payroll.deleteOne();

        res.status(204).json({
            status: 'success',
            data: null
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to delete payroll'
        });
    }
};

// Get payroll stats
export const getPayrollStats = async (req, res) => {
    try {
        const { month, year } = req.query;
        const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;
        const currentYear = year ? parseInt(year) : new Date().getFullYear();

        const payrolls = await Payroll.find({ month: currentMonth, year: currentYear });

        const stats = {
            totalPayroll: payrolls.reduce((sum, p) => sum + p.netSalary, 0),
            totalEmployees: payrolls.length,
            processed: payrolls.filter(p => p.status === 'Processed').length,
            pending: payrolls.filter(p => p.status === 'Draft' || p.status === 'Pending').length,
            paid: payrolls.filter(p => p.status === 'Paid').length,
            averageSalary: payrolls.length > 0
                ? Math.round(payrolls.reduce((sum, p) => sum + p.netSalary, 0) / payrolls.length)
                : 0
        };

        res.status(200).json({
            status: 'success',
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get payroll stats'
        });
    }
};

// Get employee payslips
export const getEmployeePayslips = async (req, res) => {
    try {
        const { employee, year } = req.query;
        const query = {};

        if (year) query.year = parseInt(year);

        // If user is not admin, force filter by their employee ID unless they're querying a specific employee
        if (req.user.role === 'employee') {
            query.employee = req.user.employee;
        } else if (req.user.role === 'manager') {
            // Managers can only see their own payslips on this endpoint
            query.employee = req.user.employee;
        } else if (employee) {
            // Admin can filter by any employee
            query.employee = employee;
        }

        const payrolls = await Payroll.find({ ...query, status: 'Paid' })
            .populate('employee', 'firstName lastName employeeId department')
            .sort({ year: -1, month: -1 });

        // Attach documentUrl from Payslip model to each payroll
        const payrollsWithDocs = await Promise.all(
            payrolls.map(async (payroll) => {
                const payslip = await Payslip.findOne({ payroll: payroll._id });
                return {
                    ...payroll.toObject(),
                    documentUrl: payslip?.documentUrl || null
                };
            })
        );

        res.status(200).json({
            status: 'success',
            results: payrollsWithDocs.length,
            data: payrollsWithDocs
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get payslips'
        });
    }
};

// Generate PDF Payslip
export const generatePayslipPDF = async (req, res) => {
    try {
        const payrollId = req.params.id;

        const payroll = await Payroll.findById(payrollId)
            .populate({
                path: 'employee',
                select: 'firstName lastName employeeId department designation email phone bankDetails',
                populate: {
                    path: 'department',
                    select: 'name'
                }
            });

        if (!payroll) {
            return res.status(404).json({
                status: 'error',
                message: 'Payroll record not found'
            });
        }

        // Fetch company settings
        const companySettings = await Settings.findOne({ category: 'company' });
        const companyName = companySettings?.settings?.companyName || 'Company Name';
        const companyAddress = companySettings?.settings?.companyAddress || 'Address Line 1, City, State - Pin Code';

        // Create PDF document
        const doc = new PDFDocument({ margin: 50 });
        const buffers = [];

        doc.on('data', buffers.push.bind(buffers));

        // Company Header
        doc.fontSize(20).fillColor('#1e40af').text(companyName, { align: 'center' });
        doc.fontSize(10).fillColor('#666').text(companyAddress, { align: 'center' });
        doc.moveDown(0.5);

        // Payslip Title
        doc.fontSize(16).fillColor('#000').text('SALARY SLIP', { align: 'center' });
        const monthName = new Date(payroll.year, payroll.month - 1).toLocaleString('default', { month: 'long' });
        doc.fontSize(10).fillColor('#666').text(`For the month of ${monthName} ${payroll.year}`, { align: 'center' });
        doc.moveDown();

        // Divider
        doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Employee Details
        const emp = payroll.employee;
        doc.fontSize(12).fillColor('#000');
        const leftCol = 50;
        const rightCol = 300;
        let y = doc.y;

        doc.text('Employee Name:', leftCol, y);
        doc.text(`${emp.firstName} ${emp.lastName}`, leftCol + 120, y);
        doc.text('Employee ID:', rightCol, y);
        doc.text(emp.employeeId, rightCol + 100, y);

        y += 20;
        doc.text('Department:', leftCol, y);
        doc.text(emp.department?.name || 'N/A', leftCol + 120, y);
        doc.text('Designation:', rightCol, y);
        doc.text(emp.designation || 'N/A', rightCol + 100, y);

        y += 20;
        doc.text('Working Days:', leftCol, y);
        doc.text(payroll.workingDays?.toString() || '0', leftCol + 120, y);
        doc.text('Present Days:', rightCol, y);
        doc.text(payroll.presentDays?.toString() || '0', rightCol + 100, y);

        doc.moveDown(2);

        // Divider
        doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Earnings and Deductions Table
        const tableTop = doc.y;
        const col1 = 50;
        const col2 = 200;
        const col3 = 320;
        const col4 = 470;

        // Table Header
        doc.fillColor('#1e40af').fontSize(11).font('Helvetica-Bold');
        doc.text('EARNINGS', col1, tableTop);
        doc.text('AMOUNT', col2, tableTop, { width: 100, align: 'right' });
        doc.text('DEDUCTIONS', col3, tableTop);
        doc.text('AMOUNT', col4, tableTop, { width: 80, align: 'right' });

        doc.font('Helvetica').fillColor('#000');
        let rowY = tableTop + 25;

        // Get max rows needed
        const maxRows = Math.max(payroll.earnings?.length || 0, payroll.deductions?.length || 0);

        for (let i = 0; i < maxRows; i++) {
            if (payroll.earnings && payroll.earnings[i]) {
                doc.fontSize(10).text(payroll.earnings[i].name, col1, rowY);
                doc.text(`₹ ${payroll.earnings[i].amount.toLocaleString('en-IN')}`, col2, rowY, { width: 100, align: 'right' });
            }
            if (payroll.deductions && payroll.deductions[i]) {
                doc.text(payroll.deductions[i].name, col3, rowY);
                doc.text(`₹ ${payroll.deductions[i].amount.toLocaleString('en-IN')}`, col4, rowY, { width: 80, align: 'right' });
            }
            rowY += 18;
        }

        rowY += 10;
        doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, rowY).lineTo(550, rowY).stroke();
        rowY += 15;

        // Totals
        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('Gross Salary:', col1, rowY);
        doc.text(`₹ ${payroll.grossSalary?.toLocaleString('en-IN') || '0'}`, col2, rowY, { width: 100, align: 'right' });
        doc.text('Total Deductions:', col3, rowY);
        doc.text(`₹ ${payroll.totalDeductions?.toLocaleString('en-IN') || '0'}`, col4, rowY, { width: 80, align: 'right' });

        rowY += 25;
        doc.strokeColor('#1e40af').lineWidth(2).moveTo(50, rowY).lineTo(550, rowY).stroke();
        rowY += 15;

        // Net Salary
        doc.fontSize(14).fillColor('#059669');
        doc.text('NET SALARY:', col1, rowY);
        doc.text(`₹ ${payroll.netSalary?.toLocaleString('en-IN') || '0'}`, 350, rowY, { width: 200, align: 'right' });

        // Footer
        doc.fontSize(8).fillColor('#666');
        doc.text('This is a computer-generated document and does not require a signature.', 50, 700, { align: 'center' });
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 50, 715, { align: 'center' });

        // Finalize PDF
        doc.end();

        // Wait for PDF to be generated
        await new Promise((resolve) => {
            doc.on('end', resolve);
        });

        const pdfBuffer = Buffer.concat(buffers);

        // Upload to Cloudinary
        const uploadResult = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: 'raw',
                    folder: 'payslips',
                    public_id: `payslip_${emp.employeeId}_${payroll.year}_${payroll.month}`,
                    format: 'pdf'
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            uploadStream.end(pdfBuffer);
        });

        // Save as private document
        const document = new Document({
            employee: emp._id,
            name: `Payslip - ${monthName} ${payroll.year}`,
            originalName: `payslip_${emp.employeeId}_${payroll.year}_${payroll.month}.pdf`,
            documentType: 'Salary Slip',
            fileUrl: uploadResult.secure_url,
            publicId: uploadResult.public_id,
            fileType: 'application/pdf',
            fileSize: pdfBuffer.length,
            description: `Salary slip for ${monthName} ${payroll.year}`,
            isPrivate: true,
            uploadedByUser: req.user?._id
        });

        await document.save();

        // Update payslip record
        await Payslip.findOneAndUpdate(
            { payroll: payroll._id },
            {
                payroll: payroll._id,
                employee: emp._id,
                documentUrl: uploadResult.secure_url,
                documentPublicId: uploadResult.public_id,
                generatedAt: new Date()
            },
            { upsert: true, new: true }
        );

        res.status(200).json({
            status: 'success',
            message: 'Payslip generated and saved to employee profile',
            data: {
                documentUrl: uploadResult.secure_url,
                documentId: document._id
            }
        });

    } catch (error) {
        console.error('PDF Generation Error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to generate payslip PDF'
        });
    }
};

// Download Payslip (stream PDF directly)
export const downloadPayslip = async (req, res) => {
    try {
        const payrollId = req.params.id;

        const payslip = await Payslip.findOne({ payroll: payrollId });

        if (!payslip || !payslip.documentUrl) {
            return res.status(404).json({
                status: 'error',
                message: 'Payslip not found. Please generate it first.'
            });
        }

        // Redirect to the PDF URL
        res.redirect(payslip.documentUrl);

    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to download payslip'
        });
    }
};
