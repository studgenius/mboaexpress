import { useAuth } from "@clerk/expo";
import {
  loadStripe,
  type Stripe,
  type StripeElements,
} from "@stripe/stripe-js";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { images } from "@/constants";
import { authFetch } from "@/../lib/fetch";
import {
  buildBookingFingerprint,
  readStoredBookingAttempt,
  reconcileBookingAttempt,
  resolveBookingAttemptId,
  settleStoredBookingAttempt,
  stripPaymentReturnParams,
  type RecoveryOutcome,
} from "@/../lib/web-booking-recovery";
import { useLocationStore } from "@/../store";
import { PaymentProps } from "@/../types/type";

type StripeResult = {
  paymentIntent?: { id: string; client_secret: string };
  customer?: string;
  error?: string;
};

type BookingResult = {
  booking_attempt_id: string;
  status: string;
};

const Payment = ({
  fullName,
  email,
  amount,
  driverId,
  rideTime,
}: PaymentProps) => {
  const {
    userAddress,
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationAddress,
    destinationLongitude,
  } = useLocationStore();

  const { getToken } = useAuth();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [resumable, setResumable] = useState(false);
  const [pendingCheckId, setPendingCheckId] = useState<string | null>(null);
  const [setupState, setSetupState] = useState<"idle" | "preparing" | "ready">(
    "idle",
  );
  const [stripeInstance, setStripeInstance] = useState<Stripe | null>(null);
  const [elements, setElements] = useState<StripeElements | null>(null);
  const [paymentElementReady, setPaymentElementReady] = useState(false);
  const [bookingAttemptId, setBookingAttemptId] = useState<string | null>(null);
  const paymentElementRef = useRef<HTMLDivElement | null>(null);
  const setupStartedRef = useRef(false);

  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  const fingerprint = buildBookingFingerprint({
    driverId,
    amount,
    rideTime,
    originLatitude: userLatitude,
    originLongitude: userLongitude,
    destinationLatitude,
    destinationLongitude,
  });

  /**
   * Recovers the booking attempt from the server. The stored attempt is only
   * discarded once the outcome is final (ride created or confirmed failure).
   * Transient errors and still-processing payments keep it for another check.
   */
  const runRecovery = useCallback(
    async (attemptId: string) => {
      setRecovering(true);
      setError(null);
      setPendingCheckId(null);

      try {
        const outcome: RecoveryOutcome = await reconcileBookingAttempt(
          attemptId,
          (id) =>
            authFetch("/(api)/booking/recover", getToken, {
              method: "POST",
              body: JSON.stringify({ booking_attempt_id: id }),
            }),
        );

        settleStoredBookingAttempt(sessionStorage, outcome);
        setupStartedRef.current = false;
        setSetupState("idle");

        if (outcome === "ride_created") {
          setResumable(false);
          setSuccess(true);
          return;
        }

        if (outcome === "terminal_failure") {
          setResumable(false);
          setError("Your payment could not be processed. Please try again.");
          return;
        }

        if (outcome === "processing") {
          setError(
            "Your payment is still being processed. Check again in a moment.",
          );
          setPendingCheckId(attemptId);
          return;
        }

        setResumable(true);
        setError("Your payment was not completed. You can resume it below.");
      } catch {
        setupStartedRef.current = false;
        setSetupState("idle");
        setError(
          "We could not confirm your payment yet. Check your connection and try again.",
        );
        setPendingCheckId(attemptId);
      } finally {
        setRecovering(false);
      }
    },
    [getToken],
  );

  useEffect(() => {
    const cleanUrl = stripPaymentReturnParams(new URL(window.location.href));

    if (cleanUrl !== window.location.href) {
      window.history.replaceState(window.history.state, "", cleanUrl);
    }

    const stored = readStoredBookingAttempt(sessionStorage);

    if (!stored) return;

    Promise.resolve().then(() => runRecovery(stored.bookingAttemptId));
  }, [runRecovery]);

  /**
   * Starts payment setup from an explicit user action. A matching stored
   * booking attempt is reused so reloads resume the same PaymentIntent.
   */
  const startPaymentSetup = async () => {
    if (!publishableKey || setupStartedRef.current) return;
    setupStartedRef.current = true;
    setSetupState("preparing");
    setPaymentElementReady(false);
    setError(null);
    setPendingCheckId(null);

    try {
      const attemptId = await resolveBookingAttemptId(
        sessionStorage,
        fingerprint,
        async () => {
          const bookingData: BookingResult = await authFetch(
            "/(api)/booking",
            getToken,
            {
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
            },
          );

          if (!bookingData?.booking_attempt_id) {
            throw new Error("Unable to start booking.");
          }

          return bookingData.booking_attempt_id;
        },
      );

      setBookingAttemptId(attemptId);

      const stripe = await loadStripe(publishableKey);
      if (!stripe) {
        throw new Error("Unable to load payment system.");
      }
      setStripeInstance(stripe);

      const data: StripeResult = await authFetch(
        "/(api)/(stripe)/create",
        getToken,
        {
          method: "POST",
          body: JSON.stringify({
            name: fullName || email.split("@")[0],
            email,
            amount,
            booking_attempt_id: attemptId,
          }),
        },
      );

      if (!data.paymentIntent?.client_secret) {
        throw new Error("Unable to initialize payment.");
      }

      const els = stripe.elements({
        clientSecret: data.paymentIntent.client_secret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#0286ff",
          },
        },
      });
      setElements(els);

      const pe = els.create("payment");
      pe.mount(paymentElementRef.current!);
      pe.on("ready", () => {
        setPaymentElementReady(true);
        setSetupState("ready");
      });
    } catch {
      setError("Unable to initialize payment. Please try again.");
      setSetupState("idle");
      setupStartedRef.current = false;
    }
  };

  const handleSubmit = async () => {
    if (!stripeInstance || !elements || !bookingAttemptId) return;
    setProcessing(true);
    setError(null);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message ?? "Payment submission failed.");
        return;
      }

      const { error: confirmError } = await stripeInstance.confirmPayment({
        elements,
        confirmParams: {
          return_url: stripPaymentReturnParams(new URL(window.location.href)),
        },
      });

      if (confirmError) {
        if (
          confirmError.type === "card_error" ||
          confirmError.type === "validation_error"
        ) {
          setError(confirmError.message ?? "Payment failed.");
        } else {
          setError("An unexpected payment error occurred.");
        }
        return;
      }

      // Client-side confirmation alone never marks success; the server
      // verifies the PaymentIntent before a ride is created.
      await runRecovery(bookingAttemptId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Payment processing failed. Please try again.",
      );
    } finally {
      setProcessing(false);
    }
  };

  const showPaymentForm = setupState === "ready";

  const startLabel =
    setupState === "preparing"
      ? "Preparing payment..."
      : resumable
        ? "Resume Payment"
        : "Start Payment";

  return (
    <>
      <View className="my-4 w-full">
        {error && (
          <Text className="mb-3 text-center text-base text-red-500">
            {error}
          </Text>
        )}

        {pendingCheckId && !recovering && (
          <Pressable
            onPress={() => runRecovery(pendingCheckId)}
            className="mb-3 w-full rounded-full border border-[#0286ff] p-4 flex flex-row justify-center items-center"
          >
            <Text className="text-lg font-bold text-[#0286ff]">
              Check payment status
            </Text>
          </Pressable>
        )}

        {!showPaymentForm && (
          <Pressable
            onPress={startPaymentSetup}
            disabled={setupState === "preparing" || recovering}
            className={`w-full rounded-full p-4 flex flex-row justify-center items-center ${
              setupState === "preparing" || recovering
                ? "bg-gray-400"
                : "bg-[#0286ff]"
            }`}
          >
            <Text className="text-lg font-bold text-white">
              {recovering ? "Checking your payment..." : startLabel}
            </Text>
          </Pressable>
        )}

        {showPaymentForm && (
          <>
            <div
              ref={paymentElementRef}
              style={{
                minHeight: paymentElementReady ? 0 : 120,
                marginBottom: 16,
              }}
            />
            <Pressable
              onPress={handleSubmit}
              disabled={processing || !paymentElementReady}
              className={`w-full rounded-full p-4 flex flex-row justify-center items-center ${
                processing || !paymentElementReady
                  ? "bg-gray-400"
                  : "bg-[#0286ff]"
              }`}
            >
              <Text className="text-lg font-bold text-white">
                {processing ? "Processing..." : "Confirm Ride"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {success && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              padding: 28,
              alignItems: "center",
              maxWidth: 360,
            }}
          >
            <img
              src={images.check as unknown as string}
              alt="Success"
              style={{ width: 112, height: 112, marginTop: 20 }}
            />

            <Text className="text-2xl text-center font-JakartaBold mt-5">
              Booking placed successfully
            </Text>

            <Text className="text-md text-general-200 font-JakartaRegular text-center mt-3">
              Thank you for your booking. Your reservation has been successfully
              placed. Please proceed with your trip.
            </Text>

            <Pressable
              onPress={() => {
                setSuccess(false);
                router.push("/(root)/(tabs)/home");
              }}
              className="mt-5 w-full rounded-full bg-[#0286ff] p-4 flex items-center"
            >
              <Text className="text-lg font-bold text-white">Back Home</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
};

export default Payment;
