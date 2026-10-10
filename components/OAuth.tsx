import React from "react";
import { Alert, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSSO } from "@clerk/expo";
import { router } from "expo-router";

import CustomButton from "./CustomButton";
import { icons } from "@/constants";

const OAuth = () => {
  const { startSSOFlow } = useSSO();

  const handleGoogleSignIn = async () => {
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
      });

      if (createdSessionId) {
        await setActive?.({
          session: createdSessionId,
        });

        router.replace("/(root)/(tabs)/home");
      }
    } catch (error) {
      console.error("Google OAuth error:", error);

      Alert.alert(
        "Google Sign-In Failed",
        "Unable to sign in with Google. Please try again.",
      );
    }
  };

  return (
    <View>
      <View className="flex flex-row justify-center items-center mt-4 gap-x-3">
        <View className="flex-1 h-[1px] bg-general-100" />

        <Text className="text-lg">Or</Text>

        <View className="flex-1 h-[1px] bg-general-100" />
      </View>

      <CustomButton
        title="Log in with Google"
        className="mt-5 w-full shadow-none"
        IconLeft={() => (
          <Image
            source={icons.google}
            contentFit="contain"
            style={{
              width: 20,
              height: 20,
              marginHorizontal: 8,
            }}
          />
        )}
        bgVariant="outline"
        textVariant="primary"
        onPress={handleGoogleSignIn}
      />
    </View>
  );
};

export default OAuth;
