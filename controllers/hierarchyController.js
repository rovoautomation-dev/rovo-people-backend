import Employee from '../models/Employee.js';
import User from '../models/User.js';

/**
 * Build complete hierarchy tree from all employees
 * @param {Array} employees - All employees with populated reportingManager (can be lean objects)
 * @returns {Array} - Tree structure with children arrays
 */
const buildHierarchyTree = (employees) => {
    const employeeMap = new Map();
    const roots = [];

    // First pass: create map of all employees
    employees.forEach(emp => {
        // Handle both Mongoose documents and lean objects
        const empData = emp.toObject ? emp.toObject() : emp;
        employeeMap.set(empData._id.toString(), {
            ...empData,
            children: []
        });
    });

    // Second pass: build tree relationships
    employees.forEach(emp => {
        const empData = emp.toObject ? emp.toObject() : emp;
        const empNode = employeeMap.get(empData._id.toString());
        if (empData.reportingManager) {
            const managerId = typeof empData.reportingManager === 'object'
                ? empData.reportingManager._id.toString()
                : empData.reportingManager.toString();
            const manager = employeeMap.get(managerId);
            if (manager) {
                manager.children.push(empNode);
            } else {
                roots.push(empNode);
            }
        } else {
            roots.push(empNode);
        }
    });

    return roots;
};

/**
 * Build upward chain from employee to top
 * @param {Object} employee - Starting employee
 * @param {Map} employeeMap - Map of all employees
 * @returns {Array} - Chain from top to employee
 */
const buildUpwardChain = (employee, employeeMap) => {
    const chain = [];
    let current = employee;

    while (current) {
        const empNode = {
            ...current,
            children: []
        };
        chain.unshift(empNode);

        if (current.reportingManager) {
            const managerId = typeof current.reportingManager === 'object'
                ? current.reportingManager._id.toString()
                : current.reportingManager.toString();
            current = employeeMap.get(managerId);
        } else {
            current = null;
        }
    }

    // Build nested structure from chain
    if (chain.length > 0) {
        for (let i = 0; i < chain.length - 1; i++) {
            chain[i].children = [chain[i + 1]];
        }
        return [chain[0]];
    }

    return chain;
};

/**
 * Build subordinate tree for a manager
 * @param {String} managerId - Manager's employee ID
 * @param {Map} employeeMap - Map of all employees
 * @param {Array} allEmployees - All employees array
 * @returns {Array} - Tree structure starting from manager
 */
const buildSubordinateTree = (managerId, employeeMap, allEmployees) => {
    const manager = employeeMap.get(managerId);
    if (!manager) return [];

    // Find direct reports
    const findDirectReports = (empId) => {
        const directReports = [];
        allEmployees.forEach(emp => {
            if (emp.reportingManager) {
                const repManagerId = typeof emp.reportingManager === 'object'
                    ? emp.reportingManager._id.toString()
                    : emp.reportingManager.toString();
                if (repManagerId === empId) {
                    const empNode = employeeMap.get(emp._id.toString());
                    if (empNode) {
                        empNode.children = findDirectReports(emp._id.toString());
                        directReports.push(empNode);
                    }
                }
            }
        });
        return directReports;
    };

    manager.children = findDirectReports(managerId);
    return [manager];
};

/**
 * Get employee hierarchy based on user
 * - Admin: Full organization tree
 * - Everyone else: 1 level up (their manager) + all levels down (all subordinates)
 */
export const getEmployeeHierarchy = async (req, res) => {
    try {
        const user = req.user;

        // Get all active employees with populated data
        const employees = await Employee.find({ status: 'Active' })
            .populate('reportingManager', 'firstName lastName designation profileImage employeeId')
            .populate('department', 'name color')
            .select('firstName lastName designation department profileImage employeeId isManager reportingManager email phone')
            .lean();

        // Create employee map for quick lookup
        const employeeMap = new Map();
        employees.forEach(emp => {
            employeeMap.set(emp._id.toString(), { ...emp, children: [] });
        });

        let hierarchy = [];
        let viewType = 'personal';

        // Admin sees full hierarchy
        if (user.role === 'admin') {
            hierarchy = buildHierarchyTree(employees);
            viewType = 'full';
        } else if (user.employee) {
            // For everyone else: show 1 level up (manager) + self + all subordinates
            const employeeId = user.employee._id ? user.employee._id.toString() : user.employee.toString();
            const currentEmployee = employeeMap.get(employeeId);

            if (currentEmployee) {
                // Build subordinate tree starting from current employee
                const buildPersonalTree = (empId) => {
                    const emp = employeeMap.get(empId);
                    if (!emp) return null;

                    // Find all direct reports
                    const directReports = [];
                    employees.forEach(e => {
                        if (e.reportingManager) {
                            const managerId = typeof e.reportingManager === 'object'
                                ? e.reportingManager._id.toString()
                                : e.reportingManager.toString();
                            if (managerId === empId) {
                                const subordinate = buildPersonalTree(e._id.toString());
                                if (subordinate) directReports.push(subordinate);
                            }
                        }
                    });

                    return {
                        ...emp,
                        children: directReports
                    };
                };

                // Get current employee with all subordinates
                const selfWithSubordinates = buildPersonalTree(employeeId);

                // Check if current employee has a manager (1 level up)
                if (currentEmployee.reportingManager) {
                    const managerId = typeof currentEmployee.reportingManager === 'object'
                        ? currentEmployee.reportingManager._id.toString()
                        : currentEmployee.reportingManager.toString();
                    const manager = employeeMap.get(managerId);

                    if (manager) {
                        // Create manager node with current employee (and their subordinates) as child
                        hierarchy = [{
                            ...manager,
                            children: selfWithSubordinates ? [selfWithSubordinates] : []
                        }];
                    } else {
                        // Manager not found, show self as root
                        hierarchy = selfWithSubordinates ? [selfWithSubordinates] : [];
                    }
                } else {
                    // No manager (current employee is at top), show self as root
                    hierarchy = selfWithSubordinates ? [selfWithSubordinates] : [];
                }

                viewType = 'personal';
            }
        }

        // Calculate stats
        const stats = {
            totalVisible: 0,
            directors: 0,
            managers: 0,
            employees: 0
        };

        const countNodes = (nodes) => {
            nodes.forEach(node => {
                stats.totalVisible++;
                if (!node.reportingManager) {
                    stats.directors++;
                } else if (node.isManager) {
                    stats.managers++;
                } else {
                    stats.employees++;
                }
                if (node.children && node.children.length > 0) {
                    countNodes(node.children);
                }
            });
        };
        countNodes(hierarchy);

        res.status(200).json({
            status: 'success',
            viewType,
            userRole: user.role,
            stats,
            data: hierarchy
        });
    } catch (error) {
        console.error('Hierarchy error:', error);
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get employee hierarchy'
        });
    }
};

/**
 * Get full organization hierarchy (admin only, for org chart)
 */
export const getFullHierarchy = async (req, res) => {
    try {
        const employees = await Employee.find({ status: 'Active' })
            .populate('reportingManager', 'firstName lastName designation profileImage employeeId')
            .populate('department', 'name color')
            .select('firstName lastName designation department profileImage employeeId isManager reportingManager email phone')
            .lean();

        const hierarchy = buildHierarchyTree(employees);

        res.status(200).json({
            status: 'success',
            data: hierarchy
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Failed to get full hierarchy'
        });
    }
};
