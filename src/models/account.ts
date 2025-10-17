import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAccount extends Document {
  id: string;
  auth_token: string;
  ct0: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
}

const AccountSchema = new Schema<IAccount>(
  {
    id: { type: String, required: false, unique: true, index: true },
    auth_token: { type: String, required: true },
    ct0: { type: String, required: true },
    enabled: { type: Boolean, required: true, default: true },
    error: { type: String, required: false, default: '' },
  },
  { timestamps: true }
);

export const AccountModel: Model<IAccount> =
  mongoose.models.Account || mongoose.model<IAccount>('Account', AccountSchema);


