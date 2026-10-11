import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { StyleSheet, Image, View, ActivityIndicator, Text } from "react-native";
import { useEffect, useState, useRef } from "react";

import { useDriverStore, useLocationStore } from "../../store";

import {
  calculateDriverTimes,
  calculateRegion,
  generateMarkersFromData,
} from "../../lib/map";

import { MarkerData, Driver } from "../../types/type";
import { icons } from "@/constants";
import { useFetch } from "@/../lib/fetch";
import MapViewDirections from "react-native-maps-directions";

const Map = ({ fullScreen = false }: { fullScreen?: boolean }) => {
  const mapRef = useRef<MapView>(null);

  const { data: drivers, loading, error } = useFetch<Driver[]>("/(api)/driver");

  const {
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocationStore();

  const { selectedDriver, setDrivers } = useDriverStore();

  const [markers, setMarkers] = useState<MarkerData[]>([]);

  const hasUserLocation =
    typeof userLatitude === "number" &&
    typeof userLongitude === "number" &&
    Number.isFinite(userLatitude) &&
    Number.isFinite(userLongitude);

  const hasDestination =
    typeof destinationLatitude === "number" &&
    typeof destinationLongitude === "number" &&
    Number.isFinite(destinationLatitude) &&
    Number.isFinite(destinationLongitude);

  const region = calculateRegion({
    userLongitude,
    userLatitude,
    destinationLatitude,
    destinationLongitude,
  });

  useEffect(() => {
    if (!Array.isArray(drivers)) return;
    if (!hasUserLocation) return;

    const newMarkers = generateMarkersFromData({
      data: drivers,
      userLatitude,
      userLongitude,
    });

    setMarkers(newMarkers);
  }, [drivers, userLatitude, userLongitude]);

  useEffect(() => {
    if (!markers.length || !hasDestination || !hasUserLocation) {
      return;
    }

    calculateDriverTimes({
      markers,
      userLatitude,
      userLongitude,
      destinationLatitude,
      destinationLongitude,
    }).then((drivers) => {
      setDrivers(drivers as MarkerData[]);
    });
  }, [
    markers,
    destinationLatitude,
    destinationLongitude,
    userLatitude,
    userLongitude,
  ]);

  // Move map when destination changes
  useEffect(() => {
    if (!mapRef.current || !hasDestination) return;

    mapRef.current.animateToRegion(
      calculateRegion({
        userLongitude,
        userLatitude,
        destinationLatitude,
        destinationLongitude,
      }),
      500,
    );
  }, [destinationLatitude, destinationLongitude]);

  if (loading || !hasUserLocation) {
    return (
      <View className="flex justify-center items-center w-full">
        <ActivityIndicator size="small" color="#000" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex justify-center items-center w-full">
        <Text>Error: {error}</Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={fullScreen ? styles.fullScreenMap : styles.map}
      mapType="mutedStandard"
      showsPointsOfInterest
      showsBuildings
      showsTraffic
      showsCompass
      showsScale
      showsUserLocation
      userInterfaceStyle="light"
      initialRegion={region}
    >
      {/* Driver markers */}
      {markers.map((marker) => (
        <Marker
          key={marker.id}
          coordinate={{
            latitude: marker.latitude,
            longitude: marker.longitude,
          }}
          title={marker.title}
        >
          <Image
            source={
              selectedDriver === marker.id ? icons.selectedMarker : icons.marker
            }
            style={styles.markerImage}
            resizeMode="contain"
          />
        </Marker>
      ))}

      {/* Pickup / User location */}
      {hasUserLocation && (
        <Marker
          coordinate={{
            latitude: userLatitude,
            longitude: userLongitude,
          }}
          title="Pickup"
          anchor={{ x: 0.5, y: 1 }}
        >
          <Image
            source={icons.pin}
            style={styles.destinationImage}
            resizeMode="contain"
          />
        </Marker>
      )}

      {/* Destination marker */}
      {hasDestination && (
        <Marker
          coordinate={{
            latitude: destinationLatitude,
            longitude: destinationLongitude,
          }}
          title="Destination"
          anchor={{ x: 0.5, y: 1 }}
        >
          <Image
            source={icons.pin}
            style={styles.destinationImage}
            resizeMode="contain"
          />
        </Marker>
      )}

      {/* ROUTE */}
      {hasUserLocation && hasDestination && (
        <MapViewDirections
          origin={{
            latitude: userLatitude,
            longitude: userLongitude,
          }}
          destination={{
            latitude: destinationLatitude,
            longitude: destinationLongitude,
          }}
          apikey={process.env.EXPO_PUBLIC_GOOGLE_API_KEY!}
          strokeColor="#0286ff"
          strokeWidth={4}
        />
      )}
    </MapView>
  );
};

const styles = StyleSheet.create({
  map: {
    width: "100%",
    height: 300,
    borderRadius: 16,
  },

  fullScreenMap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  markerImage: {
    width: 30,
    height: 30,
  },

  destinationImage: {
    width: 25,
    height: 25,
  },
});

export default Map;
