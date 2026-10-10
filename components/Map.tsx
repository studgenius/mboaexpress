import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import MapViewDirections from "react-native-maps-directions";

import { icons } from "@/constants";
import { useFetch } from "@/../lib/fetch";
import {
  calculateDriverTimes,
  calculateRegion,
  generateMarkersFromData,
} from "@/../lib/map";
import { useDriverStore, useLocationStore } from "@/../store";
import type { Driver, MarkerData } from "@/../types/type";

const directionsAPI = process.env.EXPO_PUBLIC_DIRECTIONS_API_KEY;

const Map = () => {
  const {
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocationStore();

  const { selectedDriver, setDrivers } = useDriverStore();

  const { data: drivers, loading, error } = useFetch<Driver[]>("/(api)/driver");

  // Derive markers instead of updating state inside an effect.
  const markers = useMemo(() => {
    if (
      !Array.isArray(drivers) ||
      userLatitude == null ||
      userLongitude == null
    ) {
      return [];
    }

    return generateMarkersFromData({
      data: drivers,
      userLatitude,
      userLongitude,
    });
  }, [drivers, userLatitude, userLongitude]);

  // Calculate driver arrival times when the route inputs change.
  useEffect(() => {
    if (
      markers.length === 0 ||
      userLatitude == null ||
      userLongitude == null ||
      destinationLatitude == null ||
      destinationLongitude == null
    ) {
      return;
    }

    let cancelled = false;

    const updateDriverTimes = async () => {
      try {
        const driversWithTimes = await calculateDriverTimes({
          markers,
          userLatitude,
          userLongitude,
          destinationLatitude,
          destinationLongitude,
        });

        if (!cancelled) {
          setDrivers(driversWithTimes as MarkerData[]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to calculate driver times:", err);
        }
      }
    };

    void updateDriverTimes();

    return () => {
      cancelled = true;
    };
  }, [
    markers,
    destinationLatitude,
    destinationLongitude,
    userLatitude,
    userLongitude,
    setDrivers,
  ]);

  const region = calculateRegion({
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
  });

  if (loading || userLatitude == null || userLongitude == null) {
    return (
      <View className="w-full items-center justify-center">
        <ActivityIndicator size="small" color="#000" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="w-full items-center justify-center">
        <Text>Error: {error}</Text>
      </View>
    );
  }

  const hasDestination =
    destinationLatitude != null && destinationLongitude != null;

  return (
    <MapView
      provider={PROVIDER_DEFAULT}
      className="h-full w-full rounded-2xl"
      tintColor="black"
      mapType="mutedStandard"
      showsPointsOfInterests={false}
      initialRegion={region}
      showsUserLocation
      userInterfaceStyle="light"
    >
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          coordinate={{
            latitude: marker.latitude,
            longitude: marker.longitude,
          }}
          title={marker.title}
          image={
            selectedDriver === Number(marker.id)
              ? icons.selectedMarker
              : icons.marker
          }
        />
      ))}

      {hasDestination && (
        <>
          <Marker
            key="destination"
            coordinate={{
              latitude: destinationLatitude,
              longitude: destinationLongitude,
            }}
            title="Destination"
            image={icons.pin}
          />

          {directionsAPI ? (
            <MapViewDirections
              origin={{
                latitude: userLatitude,
                longitude: userLongitude,
              }}
              destination={{
                latitude: destinationLatitude,
                longitude: destinationLongitude,
              }}
              apikey={directionsAPI}
              strokeColor="#0286FF"
              strokeWidth={2}
            />
          ) : null}
        </>
      )}
    </MapView>
  );
};

export default Map;
