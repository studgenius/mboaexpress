import { Alert, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import signUpCar from "../../../assets/images/signup-car.png";
import InputField from "../../../components/InputField";
import { useState } from "react";
import { icons, images } from "@/constants";
import CustomButton from "../../../components/CustomButton";
import { Link, router } from "expo-router";
import OAuth from "../../../components/OAuth";
import { useSignUp } from "@clerk/expo";
import { ReactNativeModal } from "react-native-modal";
import { fetchAPI } from "../../../lib/fetch";

const SignUp = () => {
  const { signUp } = useSignUp();

  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });

  // Intentionally "success" for testing the modal.
  const [verification, setVerification] = useState({
    state: "default",
    error: "",
    code: "",
  });

  const onSignUpPress = async () => {
    try {
      const { error } = await signUp.password({
        emailAddress: form.email,
        password: form.password,
      });

      if (error) {
        console.log(JSON.stringify(error, null, 2));

        Alert.alert(
          "Sign Up Error",
          error.message || "Unable to create your account.",
        );

        return;
      }

      const { error: verificationError } =
        await signUp.verifications.sendEmailCode();

      if (verificationError) {
        console.log(JSON.stringify(verificationError, null, 2));

        Alert.alert(
          "Verification Error",
          verificationError.message || "Unable to send the verification code.",
        );

        return;
      }

      setVerification({
        state: "pending",
        error: "",
        code: "",
      });
    } catch (error: any) {
      console.log(JSON.stringify(error, null, 2));

      Alert.alert("Error", error?.message || "Something went wrong.");
    }
  };

  const onPressVerify = async () => {
    try {
      const { error } = await signUp.verifications.verifyEmailCode({
        code: verification.code,
      });

      if (error) {
        setVerification({
          ...verification,
          error: error.message || "Verification failed.",
          state: "failed",
        });
        return;
      }

      if (signUp.status !== "complete") {
        setVerification({
          ...verification,
          error: "Verification succeeded, but the sign-up is not complete.",
          state: "failed",
        });
        return;
      }

      const clerk_Id = signUp.createdUserId;

      if (!clerk_Id) {
        setVerification({
          ...verification,
          error: "Unable to get your Clerk user ID.",
          state: "failed",
        });
        return;
      }

      // Finalize Clerk signup first
      const { error: finalizeError } = await signUp.finalize();

      if (finalizeError) {
        setVerification({
          ...verification,
          error:
            finalizeError.message || "Unable to complete your registration.",
          state: "failed",
        });
        return;
      }

      // Then create your database user
      await fetchAPI("/(api)/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          clerk_Id,
        }),
      });

      setVerification({
        ...verification,
        state: "success",
      });
    } catch (error: any) {
      console.log(JSON.stringify(error, null, 2));

      setVerification({
        ...verification,
        error: error?.message || "Verification failed.",
        state: "failed",
      });
    }
  };

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="flex-1 bg-white">
        <View className="relative w-full h-[250px]">
          <Image
            source={signUpCar}
            style={{ width: "100%", height: 250 }}
            contentFit="contain"
          />

          <Text className="text-2xl text-black font-JakartaSemiBold absolute bottom-5 left-5">
            Create Your Account
          </Text>
        </View>

        <View className="p-5">
          <InputField
            label="Name"
            placeholder="Enter your name"
            icon={icons.person}
            value={form.name}
            onChangeText={(value) => setForm({ ...form, name: value })}
          />

          <InputField
            label="Email"
            placeholder="Enter your email"
            icon={icons.email}
            value={form.email}
            onChangeText={(value) => setForm({ ...form, email: value })}
          />

          <InputField
            label="Password"
            placeholder="Enter your password"
            icon={icons.lock}
            secureTextEntry
            value={form.password}
            onChangeText={(value) => setForm({ ...form, password: value })}
          />

          <CustomButton
            title="Sign Up"
            onPress={onSignUpPress}
            className="mt-6"
          />

          <OAuth />
        </View>

        <Link
          href="/sign-in"
          className="text-lg text-center text-general-200 mt-10"
        >
          <Text className="text-center">Already have an account? </Text>

          <Text className="text-primary-500">Log In</Text>
        </Link>

        <ReactNativeModal
          isVisible={verification.state === "pending"}
          onModalHide={() => {
            if (verification.state === "success") setShowSuccessModal(true);
          }}
        >
          <View className="bg-white px-7 py-9 rounded-2xl min-h-[300px]">
            <Text className="text-2xl font-JakartaExtraBold mb-2">
              Verification
            </Text>
            <Text className="font-Jakarta mb-5">
              We&#39;ve sent a verification code to {form.email}
            </Text>

            <InputField
              label="Code"
              icon={icons.lock}
              placeholder="12345"
              value={verification.code}
              keyboardType="numeric"
              onChangeText={(code) =>
                setVerification({ ...verification, code })
              }
            />

            {verification.error && (
              <Text className="text-red-500 text-sm mt-1">
                {verification.error}
              </Text>
            )}

            <CustomButton
              title="Verify Email"
              onPress={onPressVerify}
              className="mt-5 bg-success-500"
            />
          </View>
        </ReactNativeModal>

        <ReactNativeModal isVisible={showSuccessModal}>
          <View className="bg-white px-7 py-9 rounded-2xl min-h-[300px]">
            <Image
              source={images.check}
              style={{
                width: 110,
                height: 110,
                marginHorizontal: "auto",
                marginVertical: 20,
              }}
              contentFit="contain"
            />

            <Text className="text-2xl font-JakartaBold text-center">
              Verified
            </Text>

            <Text className="text-base text-gray-500 text-center mt-2">
              Your account has been successfully verified.
            </Text>

            <CustomButton
              title="Browse Home"
              onPress={() => {
                setShowSuccessModal(false);
                router.push("/(root)/(tabs)/home");
              }}
              className="mt-5"
            />
          </View>
        </ReactNativeModal>
      </View>
    </ScrollView>
  );
};

export default SignUp;
