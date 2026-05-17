// MongoDB initialization script
// Runs once when the container is first created

db = db.getSiblingDB(process.env.MONGO_INITDB_DATABASE || "hr-crm");

// Create a dedicated app user with readWrite access to the HR CRM database
db.createUser({
  user: process.env.MONGO_APP_USER || "hr_user",
  pwd: process.env.MONGO_APP_PASSWORD || "hr_password",
  roles: [{ role: "readWrite", db: process.env.MONGO_INITDB_DATABASE || "hr-crm" }],
});

print("✅ MongoDB initialized: user created for database hr-crm");
