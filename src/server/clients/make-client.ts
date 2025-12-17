export class MakeClient {
  public static async setRecord({
    key,
    value,
  }: {
    key: string;
    value: string;
  }) {
    const makeSetRecordWebhookUrl = process.env.MAKE_SET_RECORD_WEBHOOK_URL;
    if (!makeSetRecordWebhookUrl) {
      throw new Error("MAKE_SET_RECORD_WEBHOOK_URL is not set");
    }
    const response = await fetch(makeSetRecordWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": process.env.MAKE_AUTH_HEADER!,
      },
      body: JSON.stringify({ key, value }),
    });
    if (!response.ok) {
      throw new Error("Failed to set record");
    }
    return;
  }

  public static async getRecord({ key }: { key: string }): Promise<any | null> {
    try {
      const makeGetRecordWebhookUrl = process.env.MAKE_GET_RECORD_WEBHOOK_URL;
      if (!makeGetRecordWebhookUrl) {
        throw new Error("MAKE_GET_RECORD_WEBHOOK_URL is not set");
      }
      const response = await fetch(makeGetRecordWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-make-apikey": process.env.MAKE_AUTH_HEADER!,
        },
        body: JSON.stringify({ key }),
      });

      return await response.json();
    } catch (error) {
      return null;
    }
  }
}
