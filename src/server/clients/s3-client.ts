import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromSSO } from "@aws-sdk/credential-provider-sso";

export const client = new S3Client({
  region: "us-west-1",
  credentials: fromSSO({ profile: process.env.AWS_SSO_PROFILE }),
});

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
