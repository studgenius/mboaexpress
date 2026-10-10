import * as SecureStore from "expo-secure-store";

import { fetchAPI } from "./fetch";

export const tokenCache = {
  async getToken(key: string) {
    try {
      const item = await SecureStore.getItemAsync(key);

      if (item) {
        console.log(`${key} was used 🔐`);
      } else {
        console.log("No values stored under key:", key);
      }

      return item;
    } catch (error) {
      console.error("SecureStore get item error:", error);

      await SecureStore.deleteItemAsync(key);

      return null;
    }
  },

  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error("SecureStore save item error:", error);
    }
  },
};

export const googleSSO = async (startSSOFlow: any) => {
  try {
    const { createdSessionId, setActive, signUp } = await startSSOFlow({
      strategy: "oauth_google",
    });

    if (!createdSessionId) {
      return {
        success: false,
        code: "no_session",
        message: "Google sign-in did not create a session.",
      };
    }

    if (!setActive) {
      return {
        success: false,
        code: "no_set_active",
        message: "Unable to activate the Google session.",
      };
    }

    await setActive({
      session: createdSessionId,
    });

    // Create your application user only when this
    // was actually a new Clerk signup.
    if (signUp?.createdUserId) {
      await fetchAPI("/(api)/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `${signUp.firstName ?? ""} ${signUp.lastName ?? ""}`.trim(),
          email: signUp.emailAddress,
          clerkId: signUp.createdUserId,
        }),
      });
    }

    return {
      success: true,
      code: "success",
      message: "You have successfully signed in with Google.",
    };
  } catch (error: any) {
    console.error("Google SSO error:", error);

    return {
      success: false,
      code: error?.code,
      message:
        error?.errors?.[0]?.longMessage ||
        error?.message ||
        "Unable to sign in with Google.",
    };
  }
};
