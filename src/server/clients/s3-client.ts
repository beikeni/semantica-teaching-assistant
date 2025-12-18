import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import type { IS3Manager } from "./interfaces";

const createS3Client = (): S3Client => {
  const region = process.env.AWS_REGION || "us-west-1";

  // Option 1: Static credentials (recommended for PM2/production demos)
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    console.log("[S3] Using static credentials from environment variables");
    return new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN, // Optional, for STS temporary creds
      },
    });
  }

  return new S3Client({ region });
};

export const client = createS3Client();

export class S3Manager implements IS3Manager {
  public getChapterText = async ({
    level,
    story,
    section,
    chapter,
  }: {
    level: string;
    story: string;
    section: string;
    chapter: string;
  }): Promise<string> => {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${level}/${story}/${section}/${chapter}.txt`,
    });
    const response = await client.send(command);
    if (!response.Body) {
      throw new Error("Chapter text not found");
    }
    return response.Body.transformToString();
  };

  public getLevels = async (): Promise<string[]> => {
    console.log("getLevels 2 ");
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: "",
      Delimiter: "/",
    });
    console.log("command", command);
    const response = await client.send(command);
    console.log("response", response);
    // CommonPrefixes contains the folder names at this level

    if (!response.CommonPrefixes) {
      throw new Error("No levels found");
    }
    return response.CommonPrefixes.map(
      (prefix) => prefix.Prefix?.replace("/", "") ?? ""
    );
  };

  public getLevelStories = async ({
    level,
  }: {
    level: string;
  }): Promise<string[]> => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    if (!response.CommonPrefixes) {
      throw new Error("No stories found");
    }
    return response.CommonPrefixes.map(
      (prefix) => prefix.Prefix?.replace(`${level}/`, "").replace("/", "") ?? ""
    );
  };

  public getStorySections = async ({
    level,
    story,
  }: {
    level: string;
    story: string;
  }): Promise<string[]> => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/${story}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    if (!response.CommonPrefixes) {
      throw new Error("No sections found");
    }
    return response.CommonPrefixes.map(
      (prefix) =>
        prefix.Prefix?.replace(`${level}/${story}/`, "").replace("/", "") ?? ""
    );
  };
  public getSectionChapters = async ({
    level,
    story,
    section,
  }: {
    level: string;
    story: string;
    section: string;
  }): Promise<string[]> => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/${story}/${section}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    if (!response.Contents) {
      throw new Error("No chapters found");
    }
    return response.Contents.filter((content) => content.Key)
      .filter((content) => !content.Key?.includes("english-translation"))
      .map(
        (content) =>
          content.Key?.replace(`${level}/${story}/${section}/`, "")
            .replace("/", "")
            .replace(".txt", "") ?? ""
      );
  };
}

export const s3Manager = new S3Manager();
