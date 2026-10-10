import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth, useUser } from "@clerk/expo";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import * as Location from "expo-location";
import { router } from "expo-router";

import { icons, images } from "@/constants";
import GoogleTextInput from "@/components/GoogleTextInput";
import Map from "@/components/Map";
import RideCard from "../../../../components/RideCard";
import { useLocationStore } from "../../../../store";
import { useFetch } from "../../../../lib/fetch";
import type { Ride } from "../../../../types/type";

export default function Page() {
  const { isLoaded, isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const { startHostedAuth } = useHostedAuth();

  const { setUserLocation, setDestinationLocation } = useLocationStore();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);

  const { data: recentRides, loading } = useFetch<Ride[]>(
    user?.id ? `/(api)/ride/${user.id}` : "",
  );

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      await signOut();
      router.replace("/(auth)/sign-in");
    } catch (error) {
      console.error("Sign-out error:", error);
      Alert.alert("Error", "Unable to sign out. Please try again.");
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut, isSigningOut]);

  const handleSignUp = useCallback(async () => {
    if (isSigningUp) return;

    setIsSigningUp(true);

    try {
      await startHostedAuth({ mode: "sign-up" });
    } catch (error) {
      console.error("Sign-up error:", error);
      Alert.alert("Error", "Unable to open sign-up. Please try again.");
    } finally {
      setIsSigningUp(false);
    }
  }, [startHostedAuth, isSigningUp]);

  const handleDestinationPress = useCallback(
    (location: { latitude: number; longitude: number; address: string }) => {
      setDestinationLocation(location);
      router.push("/(root)/find-ride");
    },
    [setDestinationLocation],
  );

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;

    const requestLocation = async () => {
      setLocationLoading(true);

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== "granted") {
          if (!cancelled) {
            Alert.alert(
              "Location permission",
              "Allow location access to see your current location.",
            );
          }
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = location.coords;

        const addresses = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        if (cancelled) return;

        const place = addresses[0];

        const address = place
          ? [place.name, place.street, place.city, place.region]
              .filter(Boolean)
              .filter((value, index, values) => values.indexOf(value) === index)
              .join(", ")
          : "Current location";

        setUserLocation({
          latitude,
          longitude,
          address,
        });
      } catch (error) {
        if (!cancelled) {
          console.error("Location error:", error);
          Alert.alert(
            "Location unavailable",
            "We couldn't retrieve your location. Please try again.",
          );
        }
      } finally {
        if (!cancelled) {
          setLocationLoading(false);
        }
      }
    };

    void requestLocation();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, setUserLocation]);

  if (!isLoaded) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#0286FF" />
      </SafeAreaView>
    );
  }

  if (!isSignedIn) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Button
          title={isSigningUp ? "Opening..." : "Sign up"}
          onPress={handleSignUp}
          disabled={isSigningUp}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <FlatList
        data={recentRides?.slice(0, 4) ?? []}
        keyExtractor={(item) => String(item.ride_id)}
        renderItem={({ item }) => <RideCard ride={item} />}
        className="px-5"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={() => (
          <View className="flex-col items-center justify-center">
            {loading ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Image
                  source={images.noResult}
                  className="h-40 w-40"
                  accessibilityLabel="No recent rides found"
                  resizeMode="contain"
                />
                <Text className="text-sm">No recent rides found</Text>
              </>
            )}
          </View>
        )}
        ListHeaderComponent={() => (
          <>
            <View className="my-5 flex-row items-center justify-between">
              <Text className="font-JakartaExtraBold text-2xl">
                Welcome,{" "}
                <Text className="text-primary-500 capitalize">
                  {user?.firstName ||
                    user?.emailAddresses[0]?.emailAddress.split("@")[0]}
                </Text>{" "}
                👋
              </Text>

              <TouchableOpacity
                onPress={handleSignOut}
                disabled={isSigningOut}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                className="h-10 w-10 items-center justify-center rounded-full bg-white"
              >
                {isSigningOut ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Image
                    source={icons.out}
                    className="h-4 w-4"
                    resizeMode="contain"
                  />
                )}
              </TouchableOpacity>
            </View>

            <GoogleTextInput
              icon={icons.search}
              containerStyle="bg-white shadow-md shadow-neutral-300 px-4 h-[55px]"
              handlePress={handleDestinationPress}
            />

            <Text className="mb-3 mt-5 font-JakartaBold text-xl">
              Your Current Location
            </Text>

            {locationLoading ? (
              <ActivityIndicator size="small" color="#0286FF" />
            ) : (
              <View className="flex-row items-center">
                <Map />
              </View>
            )}

            <Text className="mb-3 mt-5 font-JakartaBold text-xl">
              Recent Rides
            </Text>
          </>
        )}
      />
    </SafeAreaView>
  );
}
