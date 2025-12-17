import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromSSO } from "@aws-sdk/credential-provider-sso";

/**
 * Creates S3 client with flexible credential handling:
 *
 * - If AWS_ACCESS_KEY_ID is set: Uses static credentials from environment
 *   (works with PM2 ecosystem.config.js)
 *
 * - If AWS_SSO_PROFILE is set: Uses SSO credentials
 *   (requires aws sso login on the host machine)
 *
 * - Otherwise: Falls back to default AWS credential chain
 *   (IAM roles, instance profiles, etc.)
 */
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

  // Option 2: SSO credentials (for local development or when SSO is configured)
  if (process.env.AWS_SSO_PROFILE) {
    console.log(
      `[S3] Using SSO credentials with profile: ${process.env.AWS_SSO_PROFILE}`
    );
    return new S3Client({
      region,
      credentials: fromSSO({ profile: process.env.AWS_SSO_PROFILE }),
    });
  }

  // Option 3: Default credential chain (IAM roles, instance profiles, etc.)
  console.log("[S3] Using default AWS credential chain");
  return new S3Client({ region });
};

export const client = createS3Client();

export class S3Manager {
  public static getChapterText = async ({
    level,
    story,
    section,
    chapter,
  }: {
    level: string;
    story: string;
    section: string;
    chapter: string;
  }) => {
    const command = new GetObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${level}/${story}/${section}/${chapter}.txt`,
    });
    const response = await client.send(command);
    return response.Body?.transformToString();
  };

  public static getLevels = async () => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: "",
      Delimiter: "/",
    });
    const response = await client.send(command);
    // CommonPrefixes contains the folder names at this level
    return (
      response.CommonPrefixes?.map((prefix) =>
        prefix.Prefix?.replace("/", "")
      ) ?? []
    );
  };

  public static getLevelStories = async ({ level }: { level: string }) => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    return (
      response.CommonPrefixes?.map((prefix) =>
        prefix.Prefix?.replace(`${level}/`, "").replace("/", "")
      ) ?? []
    );
  };

  public static getStorySections = async ({
    level,
    story,
  }: {
    level: string;
    story: string;
  }) => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/${story}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    return (
      response.CommonPrefixes?.map((prefix) =>
        prefix.Prefix?.replace(`${level}/${story}/`, "").replace("/", "")
      ) ?? []
    );
  };
  public static getSectionChapters = async ({
    level,
    story,
    section,
  }: {
    level: string;
    story: string;
    section: string;
  }) => {
    const command = new ListObjectsV2Command({
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: `${level}/${story}/${section}/`,
      Delimiter: "/",
    });
    const response = await client.send(command);
    return (
      response.Contents?.filter(
        (content) => !content.Key?.includes("english-translation")
      ).map((prefix) =>
        prefix.Key?.replace(`${level}/${story}/${section}/`, "")
          .replace("/", "")
          .replace(".txt", "")
      ) ?? []
    );
  };
}
