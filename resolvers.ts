import { APIPhone, APITime, ContactModel } from "./types.ts";
import { Collection, ObjectId } from "mongodb";
import { GraphQLError } from "graphql";

type GetContactQueryArgs = {
  id: string;
};

type DeleteContactMutationArgs = {
  id: string;
};

type AddContactMutationArgs = {
  name: string;
  phone: string;
  friends?: string[];
};

type UpdateContactMutationArgs = {
  id: string;
  name?: string;
  phone?: string;
  friends?: string[];
};

type Context = {
  ContactsCollection: Collection<ContactModel>;
};

export const resolvers = {
  Query: {
    getContact: async (_: unknown, args: GetContactQueryArgs, ctx: Context): Promise<ContactModel | null> => {
      return await ctx.ContactsCollection.findOne({ _id: new ObjectId(args.id) });
    },
    getContacts: async (_: unknown, __: unknown, ctx: Context): Promise<ContactModel[]> => await ctx.ContactsCollection.find().toArray(),
  },

  Mutation: {
    deleteContact: async (_: unknown, args: DeleteContactMutationArgs, ctx: Context): Promise<boolean> => {
      const { deletedCount } = await ctx.ContactsCollection.deleteOne({ _id: new ObjectId(args.id) });
      return deletedCount === 1;
    },
    addContact: async (_: unknown, args: AddContactMutationArgs, ctx: Context): Promise<ContactModel> => {
      const API_KEY = Deno.env.get("API_KEY");
      if (!API_KEY) throw new GraphQLError("You need the Api Ninja API_KEY");

      const { phone, name, friends } = args;
      const phoneExist = await ctx.ContactsCollection.countDocuments({ phone });
      if (phoneExist >= 1) throw new GraphQLError("Phone exists");

      const url = `https://api.api-ninjas.com/v1/validatephone?number=${phone}`;
      const data = await fetch(url, {
        headers: {
          "X-Api-Key": API_KEY,
        },
      });
      if (data.status !== 200) throw new GraphQLError("API Ninja Error");

      const response: APIPhone = await data.json();
      const country = response.country;
      const timezone = response.timezones[0];

      const { insertedId } = await ctx.ContactsCollection.insertOne({
        name,
        phone,
        country,
        timezone,
        friends: friends ? friends.map((id) => new ObjectId(id)) : [],
      });

      return {
        _id: insertedId,
        name,
        phone,
        country,
        timezone,
        friends: friends ? friends.map((id) => new ObjectId(id)) : [],
      };
    },
    updateContact: async (_: unknown, args: UpdateContactMutationArgs, ctx: Context): Promise<ContactModel> => {
      const API_KEY = Deno.env.get("API_KEY");
      if (!API_KEY) throw new GraphQLError("You need the Api Ninja API_KEY");

      const { id, phone, name, friends } = args;
      if (!phone && !name && !friends) {
        throw new GraphQLError("You must at least update one value");
      }

      const updateData: Partial<ContactModel> = {};
      if (name) updateData.name = name;
      if (friends) updateData.friends = friends.map((id) => new ObjectId(id));

      if (phone) {
        const phoneExists = await ctx.ContactsCollection.findOne({ phone });
        if (phoneExists && phoneExists._id.toString() !== id) throw new GraphQLError("Phone already taken");

        const url = `https://api.api-ninjas.com/v1/validatephone?number=${phone}`;
        const data = await fetch(url, {
          headers: {
            "X-Api-Key": API_KEY,
          },
        });
        if (data.status !== 200) throw new GraphQLError("API Ninja Error");

        const response: APIPhone = await data.json();
        if (!response.is_valid) throw new GraphQLError("Not valid phone format");

        updateData.phone = phone;
        updateData.country = response.country;
        updateData.timezone = response.timezones[0];
      }

      const { value: updatedContact } = await ctx.ContactsCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateData },
        { returnDocument: "after" }
      );

      if (!updatedContact) throw new GraphQLError("User not found!");
      return updatedContact;
    },
  },

  Contact: {
    id: (parent: ContactModel): string => parent._id?.toString(),
    time: async (parent: ContactModel): Promise<string> => {
      const API_KEY = Deno.env.get("API_KEY");
      if (!API_KEY) throw new GraphQLError("You need the Api Ninja API_KEY");

      const timezone = parent.timezone;
      const url = `https://api.api-ninjas.com/v1/worldtime?timezone=${timezone}`;
      const data = await fetch(url, {
        headers: {
          "X-Api-Key": API_KEY,
        },
      });
      if (data.status !== 200) throw new GraphQLError("API NINJA ERROR");

      const response: APITime = await data.json();
      return response.datetime;
    },
    friends: async (parent: ContactModel, _: unknown, ctx: Context) => {
      if (!Array.isArray(parent.friends)) {
        return [];
      }
      const ids = parent.friends.map((id) => new ObjectId(id));
      return await ctx.ContactsCollection.find({ _id: { $in: ids } }).toArray();
    },
  },
};