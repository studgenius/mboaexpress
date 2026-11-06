import { useAuth } from "@clerk/expo";
import { useStripe } from "@stripe/stripe-react-native";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Alert, Image, Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/../components/CustomButton";
import { images } from "@/constants";
import { authFetch } from "@/../lib/fetch";
import { useLocationStore } from "@/../store";
import { PaymentProps } from "@/../types/type";

const MAX_RECOVERY_POLLS = 10;
const RECOVERY_POLL_INTERVAL_MS = 1500;

type RecoveryResult = {
  booking_status: string;
  payment_status: string;
  ride?: Record<string, unknown>;
  created?: boolean;
};

const Payment = ({
  fullName,
  email,
  amount,
  driverId,
  rideTime,
}: PaymentProps) => {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const {
    userAddress,
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationAddress,
    destinationLongitude,
  } = useLocationStore();

  const { getToken } = useAuth();
  const [success, setSuccess] = useState<boolean>(false);
  const [recovering, setRecovering] = useState<boolean>(false);
  const bookingAttemptIdRef = useRef<string | null>(null);
  const paymentIntentIdRef = useRef<string | null>(null);

  const openPaymentSheet = async () => {
    // Step 0: Create a durable booking attempt on the server.
    let bookingAttemptId: string;

    try {
      const bookingData = await authFetch("/(api)/booking", getToken, {
        method: "POST",
        body: JSON.stringify({
          origin_address: userAddress,
          destination_address: destinationAddress,
          origin_latitude: userLatitude,
          origin_longitude: userLongitude,
          destination_latitude: destinationLatitude,
          destination_longitude: destinationLongitude,
          ride_time: rideTime.toFixed(0),
          driver_id: driverId,
          expected_amount: amount,
        }),
      });

      bookingAttemptId = bookingData.booking_attempt_id;
      bookingAttemptIdRef.current = bookingAttemptId;
    } catch {
      Alert.alert(
        "Booking failed",
        "Unable to start booking. Please try again.",
      );
      return;
    }

    await initializePaymentSheet(bookingAttemptId);

    const { error } = await presentPaymentSheet();

    if (error) {
      Alert.alert(`Error code: ${error.code}`, error.message);
      return;
    }

    // PaymentSheet completed without error — reconcile the booking
    // state with the server. The server independently retrieves the
    // PaymentIntent from Stripe and verifies ownership, status, and
    // currency before treating the payment as successful.
    await reconcileBooking(bookingAttemptId);
  };

  const initializePaymentSheet = async (bookingAttemptId: string) => {
    const { error } = await initPaymentSheet({
      merchantDisplayName: "Example, Inc.",
      intentConfiguration: {
        mode: {
          amount: parseInt(amount) * 100,
          currencyCode: "eur",
        },
        confirmHandler: async (
          _paymentMethod,
          _shouldSavePaymentMethod,
          intentCreationCallback,
        ) => {
          // Create or reuse the PaymentIntent linked to the booking
          // attempt. The server embeds the authenticated Clerk user
          // ID and booking_attempt_id into the PaymentIntent metadata.
          // If the booking already has a reusable PI, the server
          // returns it instead of creating a duplicate.
          let createData;

          try {
            createData = await authFetch("/(api)/(stripe)/create", getToken, {
              method: "POST",
              body: JSON.stringify({
                name: fullName || email.split("@")[0],
                email: email,
                amount: amount,
                booking_attempt_id: bookingAttemptId,
              }),
            });
          } catch {
            intentCreationCallback({
              error: {
                code: "Failed",
                message: "Unable to create payment intent.",
              },
            });
            return;
          }

          if (!createData?.paymentIntent?.client_secret) {
            intentCreationCallback({
              error: {
                code: "Failed",
                message: "Unable to create payment intent.",
              },
            });
            return;
          }

          paymentIntentIdRef.current = createData.paymentIntent.id;

          // Hand the client secret back to the PaymentSheet. The SDK
          // handles confirmation and 3DS authentication internally.
          // We do NOT call a server-side confirm endpoint here — the
          // PaymentSheet confirms the PI client-side using the
          // publishable key, and the webhook or recovery endpoint
          // handles ride creation after verifying the PI status
          // server-side.
          intentCreationCallback({
            clientSecret: createData.paymentIntent.client_secret,
          });
        },
      },
      returnURL: "mboaexpress://book-ride",
    });

    if (error) {
      Alert.alert("Payment setup failed", error.message);
    }
  };

  /**
   * Reconciles the booking state after the PaymentSheet completes.
   * Polls the recovery endpoint with a bounded retry count. If the
   * webhook has already created the ride, the recovery endpoint
   * returns it. If the webhook is delayed, we poll until the ride
   * appears or the poll limit is reached.
   */
  const reconcileBooking = async (bookingAttemptId: string) => {
    setRecovering(true);

    try {
      for (let attempt = 0; attempt < MAX_RECOVERY_POLLS; attempt++) {
        const result: RecoveryResult = await authFetch(
          "/(api)/booking/recover",
          getToken,
          {
            method: "POST",
            body: JSON.stringify({
              booking_attempt_id: bookingAttemptId,
            }),
          },
        );

        // Ride exists — payment confirmed and ride created.
        if (result.ride) {
          setSuccess(true);
          return;
        }

        // Payment failed or canceled — show error.
        if (
          result.payment_status === "failed" ||
          result.payment_status === "canceled"
        ) {
          Alert.alert(
            "Payment not completed",
            "Your payment could not be processed. Please try again.",
          );
          return;
        }

        // Payment succeeded but ride not yet created (webhook delayed).
        // Continue polling if we have attempts left.
        if (result.payment_status === "succeeded" && !result.ride) {
          if (attempt < MAX_RECOVERY_POLLS - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, RECOVERY_POLL_INTERVAL_MS),
            );
            continue;
          }
        }

        // Pending states (requires_action, processing, etc.) — keep polling.
        if (attempt < MAX_RECOVERY_POLLS - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, RECOVERY_POLL_INTERVAL_MS),
          );
          continue;
        }
      }

      // Exhausted polls — the payment may have succeeded but the
      // webhook/recovery couldn't create the ride yet. Show a
      // recoverable state instead of claiming success or failure.
      Alert.alert(
        "Payment processing",
        "Your payment is being processed. Your booking will be confirmed shortly. You can check your rides for updates.",
        [
          {
            text: "OK",
            onPress: () => router.push("/(root)/(tabs)/home"),
          },
        ],
      );
    } catch (err) {
      // Recovery endpoint returned an error (transient DB failure, etc.)
      // The payment may have succeeded — show a recoverable state.
      const message =
        err instanceof Error
          ? err.message
          : "Payment processing incomplete. Please check your rides.";
      Alert.alert("Payment processing", message, [
        {
          text: "OK",
          onPress: () => router.push("/(root)/(tabs)/home"),
        },
      ]);
    } finally {
      setRecovering(false);
    }
  };

  return (
    <>
      <CustomButton
        title={recovering ? "Confirming..." : "Confirm Ride"}
        className="my-10"
        onPress={openPaymentSheet}
        disabled={recovering}
      />

      <ReactNativeModal
        isVisible={success}
        onBackdropPress={() => setSuccess(false)}
      >
        <View className="flex flex-col items-center justify-center bg-white p-7 rounded-2xl">
          <Image source={images.check} className="w-28 h-28 mt-5" />

          <Text className="text-2xl text-center font-JakartaBold mt-5">
            Booking placed successfully
          </Text>

          <Text className="text-md text-general-200 font-JakartaRegular text-center mt-3">
            Thank you for your booking. Your reservation has been successfully
            placed. Please proceed with your trip.
          </Text>

          <CustomButton
            title="Back Home"
            onPress={() => {
              setSuccess(false);
              router.push("/(root)/(tabs)/home");
            }}
            className="mt-5"
          />
        </View>
      </ReactNativeModal>
    </>
  );
};

export default Payment;
