import { Ride } from "../types/type";
import { View, Text, Image } from "react-native";
import { icons } from "@/constants";
import { formatDate, formatTime } from "../lib/utils";

const RideCard = ({
  ride: {
    destination_longitude,
    destination_latitude,
    origin_address,
    destination_address,
    created_at,
    ride_time,
    driver,
    payment_status,
  },
}: {
  ride: Ride;
}) => (
  <View className="bg-white rounded-lg shadow-sm shadow-neutral-300 mb-3 p-3">
    <View className="flex-row items-center">
      <Image
        source={{
          uri: `https://maps.geoapify.com/v1/staticmap?style=osm-bright&width=600&height=400&center=lonlat:${destination_longitude},${destination_latitude}&zoom=14&apiKey=${process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY}`,
        }}
        className="w-[80px] h-[90px] rounded-lg"
      />

      {/* From Origin */}
      <View className="flex-1 ml-4 justify-center gap-y-5">
        <View className="flex-row items-center">
          <Image source={icons.to} className="w-5 h-5 mr-2" />
          <Text className="text-md font-JakartaMedium flex-1" numberOfLines={1}>
            {origin_address}
          </Text>
        </View>

        {/* To Destination */}
        <View className="flex-row items-center">
          <Image source={icons.point} className="w-5 h-5 mr-2" />
          <Text className="text-md font-JakartaMedium flex-1" numberOfLines={1}>
            {destination_address}
          </Text>
        </View>
      </View>
    </View>

    {/* Date & Time */}
    <View className="w-full mt-4 bg-general-500 rounded-lg p-3">
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-md font-JakartaMedium text-gray-500">
          Date & Time
        </Text>

        <Text
          className="text-md font-JakartaMedium text-gray-500 flex-1 text-right ml-3"
          numberOfLines={1}
        >
          {formatDate(created_at)}, {formatTime(ride_time)}
        </Text>
      </View>

      {/* Driver First and Last Name */}
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-md font-JakartaMedium text-gray-500">Driver</Text>

        <Text
          className="text-md font-JakartaMedium text-gray-500 flex-1 text-right ml-3"
          numberOfLines={1}
        >
          {driver.first_name} {driver.last_name}
        </Text>
      </View>

      {/* Car Seats Details */}
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-md font-JakartaMedium text-gray-500">
          Car Seats
        </Text>

        <Text
          className="text-md font-JakartaMedium text-gray-500 flex-1 text-right ml-3"
          numberOfLines={1}
        >
          {driver.car_seats}
        </Text>
      </View>

      {/* Payment Status*/}
      <View className="flex-row items-center justify-between mb-5">
        <Text className="text-md font-JakartaMedium text-gray-500">
          Payment Status
        </Text>

        <Text
          className={`text-md capitalize font-JakartaMedium text-gray-500 flex-1 text-right ml-3 ${payment_status === "paid" ? "text-green-500" : "text-red-500"}`}
          numberOfLines={1}
        >
          {payment_status}
        </Text>
      </View>
    </View>
  </View>
);

export default RideCard;
