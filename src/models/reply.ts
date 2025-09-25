import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReply extends Document {
  url: string;
  usernames: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ReplySchema = new Schema<IReply>(
  {
    url: { type: String, required: true, unique: true, index: true },
    usernames: { type: [String], default: [], index: true },
  },
  { timestamps: true }
);

export const Reply: Model<IReply> =
  mongoose.models.Reply || mongoose.model<IReply>('Reply', ReplySchema);
