import { useUser } from "@clerk/expo";
import { StripeProvider } from "@stripe/stripe-react-native";
import { Image, Text, View } from "react-native";

import Payment from "@/../components/Payment";
import RideLayout from "@/../components/RideLayout";
import { icons } from "@/constants";
import { formatTime } from "@/../lib/utils";
import { useDriverStore, useLocationStore } from "@/../store";

const BookRide = () => {
  const { user, isLoaded } = useUser();
  const { userAddress, destinationAddress } = useLocationStore();
  const { drivers, selectedDriver } = useDriverStore();

  const driverDetails = drivers.find(
    (driver) => String(driver.id) === String(selectedDriver),
  );

  const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!isLoaded || !user) {
    return (
      <RideLayout title="Book Ride">
        <View className="flex-1 items-center justify-center">
          <Text className="text-lg font-JakartaSemiBold">
            Loading your account...
          </Text>
        </View>
      </RideLayout>
    );
  }

  if (!driverDetails) {
    return (
      <RideLayout title="Book Ride">
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-center text-lg font-JakartaSemiBold">
            The selected driver is no longer available. Please select another
            driver.
          </Text>
        </View>
      </RideLayout>
    );
  }

  const email = user.emailAddresses[0]?.emailAddress;

  if (!email) {
    return (
      <RideLayout title="Book Ride">
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-center text-lg font-JakartaSemiBold">
            Please add an email address before booking a ride.
          </Text>
        </View>
      </RideLayout>
    );
  }

  if (!stripePublishableKey) {
    return (
      <RideLayout title="Book Ride">
        <View className="flex-1 items-center justify-center px-5">
          <Text className="text-center text-lg font-JakartaSemiBold">
            Payment configuration is missing. Please try again later.
          </Text>
        </View>
      </RideLayout>
    );
  }

  return (
    <StripeProvider
      publishableKey={stripePublishableKey}
      merchantIdentifier="merchant.com.mboaexpress"
      urlScheme="mboaexpress"
    >
      <RideLayout title="Book Ride">
        <View className="w-full">
          <Text className="mb-3 text-xl font-JakartaSemiBold">
            Ride Information
          </Text>

          <View className="mt-10 w-full items-center justify-center">
            {driverDetails.profile_image_url ? (
              <Image
                source={{ uri: driverDetails.profile_image_url }}
                className="h-28 w-28 rounded-full"
                accessibilityLabel="Driver profile photo"
              />
            ) : (
              <View className="h-28 w-28 items-center justify-center rounded-full bg-gray-200">
                <Text>Driver</Text>
              </View>
            )}

            <View className="mt-5 flex-row items-center justify-center gap-2">
              <Text className="text-lg font-JakartaSemiBold">
                {driverDetails.first_name} {driverDetails.last_name}
              </Text>

              <View className="flex-row items-center">
                <Image
                  source={icons.star}
                  className="h-5 w-5"
                  resizeMode="contain"
                />
                <Text className="ml-1 text-lg font-JakartaRegular">
                  {driverDetails.rating ?? "N/A"}
                </Text>
              </View>
            </View>
          </View>

          <View className="mt-5 w-full rounded-3xl bg-general-600 px-5 py-3">
            <View className="w-full flex-row items-center justify-between border-b border-white py-3">
              <Text className="text-lg font-JakartaRegular">Ride Price</Text>
              <Text className="text-lg font-JakartaRegular text-[#0CC25F]">
                €{Number(driverDetails.price ?? 0).toFixed(2)}
              </Text>
            </View>

            <View className="w-full flex-row items-center justify-between border-b border-white py-3">
              <Text className="text-lg font-JakartaRegular">Pickup Time</Text>
              <Text className="text-lg font-JakartaRegular">
                {formatTime(Math.round(driverDetails.time ?? 0))}
              </Text>
            </View>

            <View className="w-full flex-row items-center justify-between py-3">
              <Text className="text-lg font-JakartaRegular">Car Seats</Text>
              <Text className="text-lg font-JakartaRegular">
                {driverDetails.car_seats}
              </Text>
            </View>
          </View>

          <View className="mt-5 w-full">
            <View className="w-full flex-row items-center border-b border-t border-general-700 py-3">
              <Image source={icons.to} className="h-6 w-6" />
              <Text
                className="ml-2 flex-1 text-lg font-JakartaRegular"
                numberOfLines={2}
              >
                {userAddress || "Pickup location unavailable"}
              </Text>
            </View>

            <View className="w-full flex-row items-center border-b border-general-700 py-3">
              <Image source={icons.point} className="h-6 w-6" />
              <Text
                className="ml-2 flex-1 text-lg font-JakartaRegular"
                numberOfLines={2}
              >
                {destinationAddress || "Destination unavailable"}
              </Text>
            </View>
          </View>

          <Payment
            fullName={user.fullName ?? ""}
            email={email}
            amount={String(driverDetails.price ?? 0)}
            driverId={driverDetails.id}
            rideTime={driverDetails.time ?? 0}
          />
        </View>
      </RideLayout>
    </StripeProvider>
  );
};

export default BookRide;
