import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TouchableOpacity, View, Image, Text } from "react-native";
import { router } from "expo-router";
import { icons } from "@/constants";
import Map from "@/components/Map";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { createContext, useContext, useRef } from "react";

const RideSheetContext = createContext<{
  openSheet: () => void;
}>({
  openSheet: () => {},
});

export const useRideSheet = () => useContext(RideSheetContext);

interface RideLayoutProps {
  title: string;
  children: React.ReactNode;
  snapPoints?: string[];
}

const RideLayout = ({
  title,
  children,
  snapPoints = ["40%", "85%"],
}: RideLayoutProps) => {
  const bottomSheetRef = useRef<BottomSheet>(null);

  const openSheet = () => {
    bottomSheetRef.current?.snapToIndex(0);
  };

  return (
    <RideSheetContext.Provider value={{ openSheet }}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 bg-blue-500">
          {/* Full-screen map */}
          <Map fullScreen />

          {/* Header */}
          <View className="absolute left-0 right-0 top-16 z-10 flex-row items-center px-5">
            <TouchableOpacity
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <View className="h-10 w-10 items-center justify-center rounded-full bg-white">
                <Image
                  source={icons.backArrow}
                  resizeMode="contain"
                  className="h-6 w-6"
                />
              </View>
            </TouchableOpacity>

            <Text className="ml-5 text-xl font-JakartaSemiBold">
              {title || "Go back"}
            </Text>
          </View>

          {/* Bottom sheet */}
          <BottomSheet ref={bottomSheetRef} snapPoints={snapPoints} index={0}>
            <BottomSheetView
              style={{
                flex: 1,
                padding: 20,
              }}
            >
              {children}
            </BottomSheetView>
          </BottomSheet>
        </View>
      </GestureHandlerRootView>
    </RideSheetContext.Provider>
  );
};

export default RideLayout;
