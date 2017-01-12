// @flow
import React, { Component } from 'react';
import {
    View,
    NavigationExperimental,
    StyleSheet,
    Animated,
    Text,
    Dimensions,
    UIManager,
} from 'react-native';

import type {NavigationTransitionProps } from 'NavigationTypeDefinition';

import SharedItems from './SharedItems';

import type { Metrics, SharedItem } from './SharedItems';

const {
    Transitioner,
} = NavigationExperimental;

type State = {
    sharedItems: SharedItems,
}

class MaterialSharedElementTransitioner extends Component {
    state: State;
    static childContextTypes = {
        registerSharedView: React.PropTypes.func,
        unregisterSharedView: React.PropTypes.func,
    }
    constructor(props) {
        super(props);
        this.state = {
            sharedItems: new SharedItems(),
        }
    }
    measureAndUpdate(sharedItem: SharedItem) {
        // console.log('measuring:', sharedItem.name, sharedItem.containerRouteName)
        UIManager.measureInWindow(
            sharedItem.nativeHandle,
            (x, y, width, height) => {
                this.updateMetrics(
                    sharedItem.name,
                    sharedItem.containerRouteName,
                    { x, y, width, height });
            }
        );
    }
    setSharedItemsState(fun: (prevState: State) => SharedItems, callback) {
        this.setState((prevState, props) => (
            { sharedItems: fun(prevState) }
        ), callback);
    }
    updateMetrics(name: string, containerRouteName: string, metrics: Metrics) {
        console.log('updating metrics', metrics, 'name', name, 'route', containerRouteName);
        this.setSharedItemsState(prevState =>
            prevState.sharedItems.updateMetrics(name, containerRouteName, metrics)
        );
    }
    addSharedItem(sharedItem: SharedItem) {
        this.setSharedItemsState(prevState =>
            prevState.sharedItems.add(sharedItem)
        );
        // const newItems = this.state.sharedItems.add(sharedItem);
        // this.setSharedItemsState(
        //     newItems,
        //     () => {console.log(`name=${sharedItem.name} this.state.items=`, this.state.sharedItems._items.map(i=>i.name), 'newItems', newItems._items.map(i=>i.name))}
        // );
    }
    removeSharedItem(name: string, containerRouteName: string) {
        this.setSharedItemsState(prevState =>
            prevState.sharedItems.remove(name, containerRouteName)
        );
    }
    removeAllMetrics() {
        this.setSharedItemsState(prevState =>
            prevState.sharedItems.removeAllMetrics()
        );
    }
    getChildContext() {
        const self = this;
        return {
            registerSharedView(sharedItem: SharedItem) {
                // add to the state
                self.addSharedItem(sharedItem);
                // measure using UIManager if another view with the same name is mounted
                const {name, containerRouteName} = sharedItem;

                const matchingItem = self.state.sharedItems.findMatchByName(name, containerRouteName);
                // console.log(self.state.sharedItems._items.map(i => i.name))
                // console.log('registering:', sharedItem.name, sharedItem.containerRouteName, 'matchingItem=',matchingItem, 'items.count()', self.state.sharedItems.count())
                if (matchingItem) {
                    self.measureAndUpdate(sharedItem);
                    self.measureAndUpdate(matchingItem);
                }
            },
            unregisterSharedView(name: string, containerRouteName: string) {
                // console.log('Removing:', name, containerRouteName)
                self.removeSharedItem(name, containerRouteName);
            },
        };
    }
    shouldComponentUpdate(nextProps, nextState: State) {
        if (this.props === nextProps) {
            const { sharedItems } = this.state;
            const nextSharedItems = nextState.sharedItems;
            // TODO key => routeName
            const routeName = (navState) => navState.routes[navState.index];
            const fromRoute = routeName(this.props.navigationState);
            const toRoute = routeName(nextProps.navigationState);
            //TODO perhaps there are other things on the state?
            return sharedItems !== nextSharedItems && nextSharedItems.areMetricsReadyForAllPairs(fromRoute, toRoute);
        } else return true;
    }
    onTransitionEnd() {
        this.removeAllMetrics();
    }
    render() {
        return (
            <Transitioner
                configureTransition={this._configureTransition.bind(this)}
                render={this._render.bind(this)}
                navigationState={this.props.navigationState}
                style={this.props.style}
                onTransitionEnd={this.onTransitionEnd.bind(this)}
                />
        );
    }
    _configureTransition() {
        return {
            duration: 300,
            useNativeDriver: false,
        }
    }
    _render(props: NavigationTransitionProps, prevProps: NavigationTransitionProps) {
        const scenes = props.scenes.map(scene => this._renderScene({ ...props, scene }));
        const overlay = this._renderOverlay(props, prevProps);
        return (
            <View style={styles.scenes}>
                {scenes}
                {overlay}
            </View>
        )
    }
    _getOverlayContainerStyle(progress) {
        const left = progress.interpolate({
            inputRange: [0, 0.999999, 1],
            outputRange: [0, 0, 100000], // move it off screen after transition is done
        });
        return {
            left,
        };
    }
    _getSharedElementStyle(props: NavigationTransitionProps, itemFrom, itemTo) {
        const { position, progress, navigationState: {index} } = props;
        const toVsFromScaleX = itemTo.scaleRelativeTo(itemFrom).x;
        const toVsFromScaleY = itemTo.scaleRelativeTo(itemFrom).y;
        //TODO use prevProps.navigationState.index instead of position._value
        const minIdx = Math.min(index, position._value);
        const maxIdx = Math.max(index, position._value);
        const inputRange = [minIdx, maxIdx];
        const scaleX = position.interpolate({
            inputRange,
            outputRange: [1, toVsFromScaleX],
        });
        const scaleY = position.interpolate({
            inputRange,
            outputRange: [1, toVsFromScaleY],
        });
        const width = itemFrom.metrics.width;
        const height = itemFrom.metrics.height;
        const left = position.interpolate({
            inputRange,
            outputRange: [itemFrom.metrics.x, itemTo.metrics.x + width / 2 * (toVsFromScaleX - 1)],
        });
        const top = position.interpolate({
            inputRange,
            outputRange: [itemFrom.metrics.y, itemTo.metrics.y + height / 2 * (toVsFromScaleY - 1)],
        });
        return {
            width,
            height,
            elevation: this._interpolateElevation(progress, 1), // make sure shared elements stay above the faked container
            position: 'absolute',
            left,
            top,
            right: null,
            bottom: null,
            transform: [
                { scaleX },
                { scaleY },
            ],
        };
    }
    _getBBox(metricsArray: Array<Metrics>) {
        let left = top = Number.MAX_VALUE;
        let right = bottom = Number.MIN_VALUE;
        metricsArray.forEach(m => {
            if (m.x < left) left = m.x;
            if (m.y < top) top = m.y;
            if (m.x + m.width > right) right = m.x + m.width;
            if (m.y + m.height > bottom) bottom = m.y + m.height;
        });
        const width = right - left;
        const height = bottom - top;
        return { left, top, right, bottom, width, height };
    }
    _interpolateElevation(progress, base: number) {
        //TOOD perhaps should use position instead of progress
        return progress.interpolate({
            inputRange: [0, 1],
            outputRange: [5 + base, 25 + base],
        });
    }
    _renderFakedSEContainer(pairs, props: NavigationTransitionProps) {
        const fromItemBBox = this._getBBox(pairs.map(p => p.fromItem.metrics));
        const toItemBBox = this._getBBox(pairs.map(p => p.toItem.metrics));
        const { position, progress, navigationState: {index} } = props;
        //TODO use prevProps.navigationState.index instead of position._value
        const minIdx = Math.min(index, position._value);
        const maxIdx = Math.max(index, position._value);
        const inputRange = [minIdx, maxIdx];
        const left = position.interpolate({
            inputRange,
            outputRange: [fromItemBBox.left, 0],
        });
        const top = position.interpolate({
            inputRange,
            outputRange: [fromItemBBox.top, 0],
        });
        const { height: windowHeight, width: windowWidth } = Dimensions.get("window");
        const width = position.interpolate({
            inputRange,
            outputRange: [fromItemBBox.width, windowWidth],
        });
        const height = position.interpolate({
            inputRange,
            outputRange: [fromItemBBox.height, windowHeight],
        });
        const elevation = this._interpolateElevation(progress, 0);
        const style = {
            backgroundColor: '#e2e2e2',
            elevation,
            position: 'absolute',
            left,
            top,
            right: null,
            bottom: null,
            width,
            height,
        };
        return <Animated.View style={style} />;
    }
    _renderOverlay(props: NavigationTransitionProps, prevProps: NavigationTransitionProps) {
        // TODO change to routeName after switching to react-navigation
        const fromRoute = prevProps ? prevProps.scene.route.key : 'unknownRoute';
        const toRoute = props.scene.route.key;
        const pairs = this.state.sharedItems.getMeasuredItemPairs(fromRoute, toRoute);
        const sharedElements = pairs.map((pair, idx) => {
            const {fromItem, toItem} = pair;
            const animatedStyle = this._getSharedElementStyle(props, fromItem, toItem);
            const element = fromItem.reactElement;
            const cloned = React.cloneElement(element, {
                onLayout: null,
                ref: null,
            });
            return (
                <Animated.View style={[animatedStyle]} key={idx}>
                    {cloned}
                </Animated.View>
            );
        });
        // const pairsStr = pairs.map(p => Object.keys(p).map(k => `${k}: ${JSON.stringify(p[k].metrics)}`))
        // console.log('from:', fromRoute, 'to:', toRoute, 'pairs:', pairsStr, 'allReady?:', this.state.sharedItems.areMetricsReadyForAllPairs(fromRoute, toRoute), 'items:', this.state.sharedItems._items.filter(i => i.metrics).map(i => `${i.name.slice(i.name.lastIndexOf('?'))} ${i.containerRouteName} ${JSON.stringify(i.metrics)}`));
        // console.log(this.state.sharedItems._items.map(i => `${i.name} ${i.containerRouteName} ${JSON.stringify(i.metrics)}`))

        const containerStyle = this._getOverlayContainerStyle(props.progress);
        return (
            <Animated.View style={[styles.overlay, this.props.style, containerStyle]}>
                {sharedElements}
                {this._renderFakedSEContainer(pairs, props)}
            </Animated.View>
        );
    }
    _renderDarkeningOverlay(progress, position, sceneIndex: number) {
        const backgroundColor = position.interpolate({
            inputRange: [sceneIndex - 1, sceneIndex, sceneIndex + 0.2, sceneIndex + 1],
            outputRange: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.5)'],
        });
        const animatedStyle = {
            elevation: 5, // to ensure the overlay covers toolbar
            backgroundColor,
            ...this._getOverlayContainerStyle(progress)
        };
        return <Animated.View style={[styles.overlay, animatedStyle]} />;
    }
    _renderScene(props) {
        const { position, scene, progress } = props;
        const { index } = scene;
        const inputRange = [index - 1, index - 0.01, index, index + 0.99, index + 1];
        const opacity = position.interpolate({
            inputRange,
            outputRange: [0, 0, 1, 1, 0],
        });
        const style = { opacity };

        return (
            <Animated.View key={props.scene.route.key} style={[style, styles.scene]}>
                {this.props.renderScene(props)}
                {this._renderDarkeningOverlay(progress, position, index)}
            </Animated.View>
        )
    }
}

const styles = StyleSheet.create({
    scenes: {
        flex: 1,
    },
    scene: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    overlay: {
        position: 'absolute',
        top: 0,
        left: 100000, // invisible by default
        right: 0,
        bottom: 0,
    }
});

export default MaterialSharedElementTransitioner;