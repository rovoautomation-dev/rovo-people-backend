import mongoose from 'mongoose';
import BiometricDevice from './models/BiometricDevice.js';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB:', process.env.MONGODB_URI);
    const devices = await BiometricDevice.find({});
    console.log('Devices in DB:', devices);
    mongoose.connection.close();
  })
  .catch(err => console.error(err));
