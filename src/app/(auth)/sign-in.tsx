import { useCallback, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { Link, useRouter, type Href } from "expo-router";
import { useSignIn } from "@clerk/expo";

import signUpCar from "../../../assets/images/signup-car.png";
import InputField from "../../../components/InputField";
import CustomButton from "../../../components/CustomButton";
import OAuth from "../../../components/OAuth";
import { icons } from "@/constants";

const SignIn = () => {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const isSubmitting = fetchStatus === "fetching";

  const onSignInPress = useCallback(async () => {
    const emailAddress = form.email.trim();
    const password = form.password;

    if (isSubmitting) return;

    if (!emailAddress || !password) {
      Alert.alert(
        "Missing information",
        "Please enter your email and password.",
      );
      return;
    }

    try {
      const { error } = await signIn.password({
        emailAddress,
        password,
      });

      if (error) {
        Alert.alert("Sign-in failed", error.message);
        return;
      }

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              console.log("Pending session task:", session.currentTask);
              return;
            }

            router.replace(decorateUrl("/(root)/(tabs)/home") as Href);
          },
        });

        return;
      }

      if (signIn.status === "needs_second_factor") {
        Alert.alert(
          "Verification required",
          "Your account requires an additional verification step.",
        );
        return;
      }

      if (signIn.status === "needs_client_trust") {
        Alert.alert(
          "Device verification required",
          "Additional device verification is required to continue.",
        );
        return;
      }

      Alert.alert(
        "Sign-in incomplete",
        "Please check your account's verification requirements.",
      );

      console.log("Sign-in status:", signIn.status);
    } catch (error: unknown) {
      console.error("Sign-in error:", error);

      Alert.alert(
        "Sign-in failed",
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.",
      );
    }
  }, [form.email, form.password, isSubmitting, signIn, router]);

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{ flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-1 bg-white">
        <View className="relative h-[250px] w-full">
          <Image
            source={signUpCar}
            style={{ width: "100%", height: 250 }}
            contentFit="contain"
            accessibilityLabel="Car illustration"
          />

          <Text className="absolute bottom-5 left-5 font-JakartaSemiBold text-2xl text-black">
            Welcome 👋
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label="Email"
            placeholder="Enter your email"
            icon={icons.email}
            value={form.email}
            onChangeText={(value) =>
              setForm((previous) => ({
                ...previous,
                email: value,
              }))
            }
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />

          <InputField
            label="Password"
            placeholder="Enter your password"
            icon={icons.lock}
            secureTextEntry
            value={form.password}
            onChangeText={(value) =>
              setForm((previous) => ({
                ...previous,
                password: value,
              }))
            }
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
          />

          {errors?.fields?.identifier?.message ? (
            <Text className="mt-2 text-red-500">
              {errors.fields.identifier.message}
            </Text>
          ) : null}

          {errors?.fields?.password?.message ? (
            <Text className="mt-2 text-red-500">
              {errors.fields.password.message}
            </Text>
          ) : null}

          <CustomButton
            title={isSubmitting ? "Signing In..." : "Sign In"}
            onPress={onSignInPress}
            className="mt-6"
            disabled={isSubmitting}
          />

          <OAuth />
        </View>

        <Link
          href="/sign-up"
          className="mt-10 text-center text-lg text-general-200"
        >
          <Text>Don&#39;t have an account? </Text>
          <Text className="text-primary-500">Sign Up</Text>
        </Link>
      </View>
    </ScrollView>
  );
};

export default SignIn;
